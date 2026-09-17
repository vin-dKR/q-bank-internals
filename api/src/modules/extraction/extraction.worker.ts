import {
  type Document,
  KNOWN_QUESTION_TYPES,
  matchKeyToAnswer,
  parseMatchKey,
  type QuestionOption,
} from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { NewQuestion, QuestionRepository } from '../questions/index.js';
import type { DriveService } from '../drive/index.js';
import type { AiTokenUsage, UsageService } from '../usage/index.js';
import type { ExtractionJobPatch, ExtractionJobStore } from './extraction.repository.js';
import type { ExtractionRunRegistry } from './extraction-run-registry.js';
import type { ExtractionJobPayload } from './job-queue.js';
import type { PdfRasterizer } from './pdf-rasterizer.js';
import type {
  AnswerEntry,
  AnswerExtraction,
  AnswerSheet,
  ExtractedQuestion,
  VisionExtractor,
} from './vision-extractor.js';
import { materializePassages } from './group-comprehension.js';
import { mergeAnswers } from './merge-answers.js';
import { topicBindingForPage } from './topic-lookup.js';

/** Statuses that mean "don't touch it" — the guard that makes re-running a job idempotent/resumable. */
const TERMINAL_OR_ACTIVE = new Set<Document['status']>(['extracting', 'extracted', 'completed']);

const OPTION_RE = /^\s*\(?([A-Da-d1-4])\)?[.)]?\s*([\s\S]*)$/;
const TRUE_KEY_RE = /^\s*t(?:rue)?\s*$/i;
const FALSE_KEY_RE = /^\s*f(?:alse)?\s*$/i;

/** Parse "(A) body" (or "1. body") into its label + body, labelling by position as a fallback. */
function parseOption(raw: string, index: number): Pick<QuestionOption, 'label' | 'body'> {
  const match = OPTION_RE.exec(raw);
  let label = String.fromCharCode(65 + index); // A, B, C, D fallback by position
  let body = raw.trim();
  if (match) {
    const token = (match[1] ?? '').toUpperCase();
    label = /[1-4]/.test(token) ? String.fromCharCode(64 + Number(token)) : token;
    body = (match[2] ?? '').trim();
  }
  return { label, body };
}

/**
 * Resolve a raw answer-key value ("A", "(A)", "1", "AC", "True") to the label of the option it
 * selects. True/false keys are matched against the option bodies BEFORE the letter scan — the
 * answer sheet carries them verbatim, and a bare letter scan would pluck the 'a' out of "False"
 * and mark the wrong option. The letter scan itself only accepts answers made entirely of option
 * letters/digits (punctuation aside), so it can never pull a letter out of a longer word.
 */
function normalizeAnswerLabel(
  answer: string | null,
  options: ReadonlyArray<Pick<QuestionOption, 'label' | 'body'>>,
): string | null {
  if (!answer) return null;
  const boolKey = TRUE_KEY_RE.test(answer) ? TRUE_KEY_RE : FALSE_KEY_RE.test(answer) ? FALSE_KEY_RE : null;
  if (boolKey) return options.find((option) => boolKey.test(option.body))?.label ?? null;
  const compact = answer.replace(/[^A-Za-z0-9]/g, '');
  if (!/^[A-Da-d1-4]+$/.test(compact)) return null;
  const token = compact.charAt(0).toUpperCase(); // multi-correct keys like "AC": first letter, as before
  return /[1-4]/.test(token) ? String.fromCharCode(64 + Number(token)) : token;
}

/** The model's classified type, kept only when it is one of the known categories — else null. */
function normalizeQuestionType(raw: string | null): string | null {
  if (!raw) return null;
  const token = raw.trim().toLowerCase();
  return (KNOWN_QUESTION_TYPES as readonly string[]).includes(token) ? token : null;
}

/**
 * Map a model draft into the persisted Question shape (§6.1: the contract shape is canonical). The
 * model classifies each question's own type + difficulty; topic/section/subject come from the
 * operator's cut-time config, and the operator's type is the fallback when the model is unsure.
 */
function toNewQuestion(document: Document, draft: ExtractedQuestion): NewQuestion {
  const binding = topicBindingForPage(document.topics, draft.sourcePage);

  // PYQ is the segment's per-node toggle (else the legacy document-level flag). When on, the source
  // exam/year come from what the model read on the page, falling back to the document for legacy rows;
  // when off, the question carries no PYQ provenance.
  const isPyq = binding?.pyq ?? document.pyq;
  const pyq = {
    isPyq,
    pyqExam: isPyq ? draft.pyqExam ?? document.pyqExam : null,
    pyqYear: isPyq ? draft.pyqYear ?? document.pyqYear : null,
    // Paper-level provenance is the same for every question in the paper — denormalize the document's.
    paper: document.paper,
  };

  // The model classifies each question's own type; the operator's binding (else the document type) is
  // the fallback when the model returned nothing recognisable. A comprehension MEMBER is never itself
  // `comprehension` (that is the container) — default it to single_correct. So the AI applies the type,
  // while a curated coaching section still lands on its known type when the model is unsure.
  const boundType = binding?.questionType ?? document.questionType;
  const aiType = normalizeQuestionType(draft.questionType);
  // Structured match data IS a matrix question regardless of what the model called its type — the row
  // is persisted with match columns below, so its type must agree (mirrors publish's structural kind).
  const questionType = draft.match
    ? 'matrix'
    : draft.passageId !== null
      ? aiType && aiType !== 'comprehension'
        ? aiType
        : 'single_correct'
      : aiType ?? boundType;

  // A match-the-column question persists its structured columns AND the printed multiple-choice answer
  // choices (each a full matching like "A-i, B-ii, …"): the stem is the bare instruction, and the flat
  // `answer` mirrors the match key. The question page rarely prints the matching, so back-fill an empty
  // key from the merged answer sheet string. Options let the operator click the correct printed choice to
  // fill the match grid in verify; correctness is derived from the key there, so isCorrect stays false.
  if (draft.match) {
    const key = Object.keys(draft.match.key).length > 0
      ? draft.match.key
      : parseMatchKey(draft.answer ?? '');
    const answer = Object.keys(key).length > 0 ? matchKeyToAnswer(key) : draft.answer ?? '';
    const options = draft.options
      .map(parseOption)
      .map(({ label, body }) => ({ label, body, isCorrect: false }));
    return {
      documentId: document.id,
      questionNumber: draft.questionNumber,
      path: document.path,
      stem: draft.questionText,
      options,
      answer,
      match: { columns: draft.match.columns, key },
      passageId: draft.passageId,
      groupOrder: draft.groupOrder,
      explanation: draft.explanation,
      images: [],
      questionType,
      level: draft.level,
      sectionName: document.sectionName ?? document.path.section,
      topic: binding?.topicName ?? null,
      subject: binding?.subject ?? null,
      ...pyq,
      sourceRegion: { page: draft.sourcePage, bbox: [0, 0, 1, 1] },
    };
  }

  const options = draft.options.map(parseOption);
  const answerLabel = normalizeAnswerLabel(draft.answer, options);
  return {
    documentId: document.id,
    questionNumber: draft.questionNumber,
    path: document.path,
    stem: draft.questionText,
    options: options.map(({ label, body }) => ({
      label,
      body,
      isCorrect: answerLabel !== null && label === answerLabel,
    })),
    answer: draft.answer ?? '',
    match: null,
    passageId: draft.passageId,
    groupOrder: draft.groupOrder,
    explanation: draft.explanation,
    images: [],
    questionType,
    level: draft.level,
    sectionName: binding?.sectionName ?? document.sectionName ?? document.path.section,
    topic: binding?.topicName ?? null,
    subject: binding?.subject ?? null,
    ...pyq,
    sourceRegion: { page: draft.sourcePage, bbox: [0, 0, 1, 1] },
  };
}

/**
 * True when two documents belong to the SAME upload — matched by their shared `uploadGroupId` (the
 * question/answer/solution parts of one upload action carry the same id). This is what keeps each
 * answer/solution bound to its OWN question when two uploads share a chapter unit — matching by the
 * unit path alone would cross-merge their answers. Legacy rows have no id, so they fall back to the
 * old unit-path match (module + chapter + section).
 */
function sameGroup(a: Document, b: Document): boolean {
  if (a.uploadGroupId && b.uploadGroupId) return a.uploadGroupId === b.uploadGroupId;
  return (
    a.path.module === b.path.module &&
    a.path.chapter === b.path.chapter &&
    a.path.section === b.path.section
  );
}

/**
 * The heavy Phase-2 work, ported from the Python PDF Extractor and run in the worker process (never
 * the API). For one question document it: downloads the Drive PDF, rasterizes it, runs the vision
 * model, merges in answers from the sibling answer PDF, and persists the questions — updating the
 * document + job status throughout. Guarded so re-running an already-extracted document is a no-op.
 */
export class ExtractionWorker {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly questions: QuestionRepository,
    private readonly jobs: ExtractionJobStore,
    private readonly drive: DriveService,
    private readonly rasterizer: PdfRasterizer,
    private readonly extractor: VisionExtractor,
    private readonly usage: UsageService,
    private readonly runs: ExtractionRunRegistry,
    private readonly timeoutMs: number,
  ) {}

  async run(payload: ExtractionJobPayload): Promise<void> {
    const now = (): string => new Date().toISOString();
    const { jobId, documentId } = payload;

    const document = await this.documents.findById(documentId);
    if (!document) {
      await this.jobs.update(jobId, {
        status: 'failed',
        error: `Document ${documentId} not found.`,
        finishedAt: now(),
      });
      return;
    }

    // Idempotent resume: never re-extract something already done or in flight (the "don't re-push" rule).
    if (TERMINAL_OR_ACTIVE.has(document.status)) {
      logger.info({ documentId, status: document.status }, 'Extraction skipped: already processed');
      await this.jobs.update(jobId, { status: 'succeeded', finishedAt: now() });
      return;
    }

    // Only question PDFs drive extraction; answer/solution PDFs are consumed via their question sibling.
    if (document.kind !== 'question') {
      await this.jobs.update(jobId, { status: 'succeeded', finishedAt: now() });
      return;
    }

    await this.documents.updateStatus(documentId, 'extracting');
    await this.jobs.update(jobId, { status: 'running', startedAt: now() });

    // The per-run deadline: register an AbortController (so the cancel action can also reach it) and
    // arm a timer that aborts it once the run exceeds the configured budget. Both cancel and timeout
    // surface as an aborted signal on the in-flight vision call, handled in the catch below.
    const controller = this.runs.register(jobId);
    const timer = setTimeout(() => { controller.abort('timeout'); }, this.timeoutMs);

    try {
      const pdf = await this.drive.downloadPdf(document.driveFileId);
      const pages = await this.rasterizer.rasterize(pdf);
      await this.jobs.update(jobId, { pagesTotal: pages.length, pagesDone: 0 });
      const { questions: drafts, usage } = await this.extractor.extractQuestions({
        pages,
        document,
        signal: controller.signal,
        onProgress: (progress) => this.writeProgress(jobId, progress),
      });
      await this.recordUsage(document, usage);
      const answered = await this.applyAnswers(document, drafts, controller.signal);
      // The answer/solution phase swallows its own errors (a bad sibling PDF must not sink the
      // questions), so an abort that lands there would otherwise be lost — re-check the deadline
      // before persisting so a cancel/timeout still aborts instead of saving a half-answered result.
      controller.signal.throwIfAborted();
      // Comprehension sub-questions that share a passage are materialized into ONE passage row + N
      // stamped sub-question rows AFTER answers are folded in, so each sub-question keeps its own
      // answer/explanation and carries its group's passageId + order. Passages are persisted alongside
      // the questions in one wholesale replace (passages first, so every passageId resolves).
      const { drafts: grouped, passages } = materializePassages(answered, documentId);
      const rows = grouped.map((draft) => toNewQuestion(document, draft));
      const count = await this.questions.replaceDocument(documentId, passages, rows);

      await this.documents.recordExtraction(documentId, { questionCount: count });
      await this.jobs.update(jobId, {
        status: 'succeeded',
        questionsFound: count,
        pagesDone: pages.length,
        finishedAt: now(),
      });
      logger.info({ documentId, questionsFound: count }, 'Extraction complete');
    } catch (error) {
      // Document returns to a re-runnable state whether the run failed, timed out, or was cancelled.
      await this.documents.updateStatus(documentId, 'failed');
      if (controller.signal.aborted && controller.signal.reason === 'cancelled') {
        await this.jobs.update(jobId, { status: 'cancelled', finishedAt: now() });
        logger.info({ documentId }, 'Extraction cancelled');
      } else {
        const message = controller.signal.aborted
          ? errors.extractionTimedOut(this.timeoutMs).message
          : error instanceof Error
            ? error.message
            : String(error);
        await this.jobs.update(jobId, { status: 'failed', error: message, finishedAt: now() });
        logger.error({ documentId, err: message }, 'Extraction failed');
      }
    } finally {
      clearTimeout(timer);
      this.runs.release(jobId);
    }
  }

  /**
   * Persist live page progress, best-effort: a progress-write failure is logged, never allowed to
   * fail the extraction it only measures (mirrors {@link recordUsage}).
   */
  private async writeProgress(jobId: string, patch: ExtractionJobPatch): Promise<void> {
    try {
      await this.jobs.update(jobId, patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ jobId, err: message }, 'Failed to record extraction progress');
    }
  }

  /**
   * Record the token spend of one extractor call against its document. Best-effort: a usage-write
   * failure is logged, never allowed to fail the extraction it is only measuring. Zero-call usage
   * (e.g. the unconfigured extractor, or a document with no pages) is skipped.
   */
  private async recordUsage(document: Document, usage: AiTokenUsage): Promise<void> {
    if (usage.callCount === 0) return;
    try {
      await this.usage.recordUsage({
        source: 'extraction',
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        callCount: usage.callCount,
        documentId: document.id,
        sessionId: document.sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ documentId: document.id, err: message }, 'Failed to record token usage');
    }
  }

  /**
   * Extract + merge answers and explanations from the sibling answer/solution PDF(s) that describe
   * the same chapter unit (module + chapter + section) in this session. Answer PDFs supply answer
   * letters/values; solution PDFs supply the worked explanation (and back-fill a missing answer).
   * Both are folded into the drafts by (section, question number), with the document's topic config
   * threaded in so per-topic sheet sections (and per-topic numbering restarts) bind to the right
   * questions. Sheets are ordered answers-first so a solution PDF's answer only fills gaps the
   * answer sheet left — the answer sheet stays canonical.
   */
  private async applyAnswers(
    document: Document,
    drafts: ExtractedQuestion[],
    signal: AbortSignal,
  ): Promise<ExtractedQuestion[]> {
    if (!document.sessionId) return drafts;
    const siblings = await this.documents.listBySession(document.sessionId);
    const answerDocs = siblings.filter((s) => s.kind === 'answer' && sameGroup(s, document));
    const solutionDocs = siblings.filter((s) => s.kind === 'solution' && sameGroup(s, document));
    if (answerDocs.length === 0 && solutionDocs.length === 0) return drafts;

    // v2 assembled uploads pin each topic's answer/solution pages, so we read every topic's key from
    // exactly its own pages and tag it with the topic name — the drag binding decides the match, not a
    // section-name-and-number guess. Legacy uploads (no ranges) keep the whole-PDF path unchanged.
    const hasRanges = document.topics.some((topic) =>
      topic.types.some((block) => block.answerPageRange ?? block.solutionPageRange),
    );

    const sheets: AnswerSheet[] = [];
    if (hasRanges) {
      for (const answerDoc of answerDocs) {
        await this.collectTopicSheets(answerDoc, document.topics, 'answer', sheets, (pages) =>
          this.extractor.extractAnswers({ pages, document: answerDoc, signal }),
        );
      }
      for (const solutionDoc of solutionDocs) {
        await this.collectTopicSheets(solutionDoc, document.topics, 'solution', sheets, (pages) =>
          this.extractor.extractSolutions({ pages, document: solutionDoc, signal }),
        );
      }
    } else {
      for (const answerDoc of answerDocs) {
        await this.collectSheets(answerDoc, sheets, (pages) =>
          this.extractor.extractAnswers({ pages, document: answerDoc, signal }),
        );
      }
      for (const solutionDoc of solutionDocs) {
        await this.collectSheets(solutionDoc, sheets, (pages) =>
          this.extractor.extractSolutions({ pages, document: solutionDoc, signal }),
        );
      }
    }
    return mergeAnswers(drafts, sheets, document.topics);
  }

  /**
   * Exact per-topic answer/solution extraction (v2): download + rasterize the sibling once, then for
   * each topic read ONLY its bound page range and tag the produced key with the topic's own name — so
   * mergeAnswers binds it to that topic's questions by number with zero cross-topic ambiguity. The
   * association is the operator's drag, not a guess. Errors are logged and swallowed so a bad sibling
   * PDF never sinks the questions it was only meant to enrich.
   */
  private async collectTopicSheets(
    source: Document,
    topics: Document['topics'],
    kind: 'answer' | 'solution',
    sink: AnswerSheet[],
    extract: (pages: Awaited<ReturnType<PdfRasterizer['rasterize']>>) => Promise<AnswerExtraction>,
  ): Promise<void> {
    try {
      const pdf = await this.drive.downloadPdf(source.driveFileId);
      const pages = await this.rasterizer.rasterize(pdf);
      for (const topic of topics) {
        for (const block of topic.types) {
          const range = kind === 'answer' ? block.answerPageRange : block.solutionPageRange;
          if (!range) continue;
          const slice = pages.filter((page) => page.pageNumber >= range.from && page.pageNumber <= range.to);
          if (slice.length === 0) continue;
          const result = await extract(slice);
          await this.recordUsage(source, result.usage);
          // Fold every entry this range produced under the topic's own name (first write wins).
          const entries: Record<string, AnswerEntry> = {};
          for (const sheet of result.sheets) {
            for (const [number, entry] of Object.entries(sheet.entries)) {
              if (!(number in entries)) entries[number] = entry;
            }
          }
          if (Object.keys(entries).length > 0) sink.push({ sectionName: topic.name, entries });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { sourceDoc: source.id, kind: source.kind, err: message },
        'Per-topic answer/solution extraction failed; keeping questions as-is',
      );
    }
  }

  /**
   * Download + rasterize one answer/solution sibling, run the given extractor over it, record its
   * token spend, and append the produced sheets. A failure here is logged and swallowed — a bad
   * answer/solution PDF must never sink the questions it was only meant to enrich.
   */
  private async collectSheets(
    source: Document,
    sink: AnswerSheet[],
    extract: (pages: Awaited<ReturnType<PdfRasterizer['rasterize']>>) => Promise<{
      sheets: AnswerSheet[];
      usage: AiTokenUsage;
    }>,
  ): Promise<void> {
    try {
      const pdf = await this.drive.downloadPdf(source.driveFileId);
      const pages = await this.rasterizer.rasterize(pdf);
      const result = await extract(pages);
      await this.recordUsage(source, result.usage);
      sink.push(...result.sheets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { sourceDoc: source.id, kind: source.kind, err: message },
        'Answer/solution extraction failed; keeping questions as-is',
      );
    }
  }
}
