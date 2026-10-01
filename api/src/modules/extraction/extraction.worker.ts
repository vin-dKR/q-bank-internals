import {
  type AiFilled,
  type Document,
  matchKeyToAnswer,
  mergeMatrixKeyWithAnswer,
  synthesizeMatrixChoiceOptions,
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
import {
  mergeAnswerEntries,
  type AnswerEntry,
  type AnswerExtraction,
  type AnswerExtractionScope,
  type AnswerSheet,
  type ExtractedQuestion,
  type VisionExtractor,
} from './vision-extractor.js';
import { materializePassages } from './group-comprehension.js';
import { mergeAnswers } from './merge-answers.js';
import { topicBindingForPage } from './topic-lookup.js';

/** Statuses that mean "don't touch it" — the guard that makes re-running a job idempotent/resumable. */
const TERMINAL_OR_ACTIVE = new Set<Document['status']>(['extracting', 'extracted', 'completed']);

const OPTION_RE = /^\s*(?:\(\s*([^()]+?)\s*\)|([A-Za-z0-9]+)\s*[.)])\s*([\s\S]*)$/;
const TRUE_KEY_RE = /^\s*t(?:rue)?\s*$/i;
const FALSE_KEY_RE = /^\s*f(?:alse)?\s*$/i;

function fallbackOptionLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `Option${String(index + 1)}`;
}

/** Keep a short printed choice marker (A/E, 1/5, I/IV); reject OCR prose as a label. */
function normalizeOptionLabel(raw: string, index: number): string {
  const token = raw.trim().replace(/^[([{\s]+|[)\]}\s.:]+$/g, '');
  return /^[A-Za-z0-9]{1,12}$/.test(token) ? token : fallbackOptionLabel(index);
}

/** Parse a labelled option while preserving the page's actual count and labels. */
function parseOption(raw: string, index: number): Pick<QuestionOption, 'label' | 'body'> {
  const match = OPTION_RE.exec(raw);
  let label = fallbackOptionLabel(index);
  let body = raw.trim();
  if (match) {
    label = normalizeOptionLabel(match[1] ?? match[2] ?? '', index);
    body = (match[3] ?? '').trim();
  }
  return { label, body };
}

/**
 * Resolve a raw answer-key value ("A", "(A)", "1", "AC", "True") to the option labels it
 * selects. True/false keys are matched against the option bodies BEFORE the letter scan — the
 * answer sheet carries them verbatim, and a bare letter scan would pluck the 'a' out of "False"
 * and mark the wrong option. The letter scan itself only accepts answers made entirely of option
 * letters/digits (punctuation aside), so it can never pull a letter out of a longer word.
 */
function normalizeAnswerLabels(
  answer: string | null,
  options: ReadonlyArray<Pick<QuestionOption, 'label' | 'body'>>,
): Set<string> {
  if (!answer) return new Set();
  const boolKey = TRUE_KEY_RE.test(answer) ? TRUE_KEY_RE : FALSE_KEY_RE.test(answer) ? FALSE_KEY_RE : null;
  if (boolKey) {
    const label = options.find((option) => boolKey.test(option.body))?.label;
    return label ? new Set([label]) : new Set();
  }
  // A matrix mapping is a direct-response answer, never an instruction to mark ordinary choices.
  if (/(?:→|->|=)/.test(answer)) return new Set();
  const available = new Map(options.map((option) => [option.label.trim().toUpperCase(), option.label]));
  const resolve = (token: string): string | null => {
    const clean = token.trim().replace(/^[([{\s]+|[)\]}\s.:]+$/g, '').toUpperCase();
    if (!clean) return null;
    const exact = available.get(clean);
    if (exact) return exact;
    // `1` ↔ first option and `A` ↔ first option are compatibility aliases only when the printed
    // label itself does not already match. This keeps a five-option `1…5` paper intact.
    if (/^\d+$/.test(clean)) {
      const index = Number(clean) - 1;
      return Number.isSafeInteger(index) && index >= 0 ? options[index]?.label ?? null : null;
    }
    if (/^[A-Z]$/.test(clean)) {
      const index = clean.charCodeAt(0) - 65;
      return index >= 0 ? options[index]?.label ?? null : null;
    }
    return null;
  };
  const raw = answer.trim();
  const direct = resolve(raw);
  if (direct) return new Set([direct]);
  const tokens = raw.split(/[\s,;/&+]+/).filter(Boolean);
  const labels = new Set<string>();
  for (const token of tokens) {
    const resolved = resolve(token);
    if (resolved) {
      labels.add(resolved);
      continue;
    }
    // A compact multi-correct value (`AC`) means two labels only when every character maps to an
    // actual choice. This avoids breaking Roman or multi-character labels such as `III`.
    if (/^[A-Za-z0-9]{2,}$/.test(token)) {
      const characters = Array.from(token);
      const expanded = characters.map(resolve);
      if (expanded.every((label): label is string => label !== null)) {
        expanded.forEach((label) => labels.add(label));
      }
    }
  }
  return labels;
}

/**
 * Keep the stored scalar answer in the same vocabulary as the actual option labels. This prevents
 * an answer sheet's `2` from disagreeing with a question whose selected stored option is `B`, and
 * avoids the old ambiguous `IIII` serialization for Roman/numeric multiple-correct choices. True/
 * false intentionally remains human-readable because it is a valid direct answer, not merely a
 * label alias.
 */
function canonicalOptionAnswer(
  rawAnswer: string | null,
  selected: ReadonlySet<string>,
  questionType: string | null,
): string {
  const raw = rawAnswer?.trim() ?? '';
  if (!raw || selected.size === 0) return raw;
  if (questionType === 'true_false' && (TRUE_KEY_RE.test(raw) || FALSE_KEY_RE.test(raw))) return raw;
  const labels = [...selected];
  return labels.every((label) => /^[A-Za-z0-9]$/.test(label))
    ? labels.join('')
    : labels.join(', ');
}

/** A prompt-validated question-type key (including an operator's live custom master), or null. */
function normalizeQuestionType(raw: string | null): string | null {
  if (!raw) return null;
  const token = raw.trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,63}$/.test(token) ? token : null;
}

/**
 * Map a model draft into the persisted Question shape (§6.1: the contract shape is canonical). The
 * model classifies an unbound question's own type + difficulty; topic/section/subject come from the
 * operator's cut-time config. A concrete cut-time type is authoritative (except the comprehension
 * container, whose children legitimately carry their own types).
 */
function toNewQuestion(
  document: Document,
  draft: ExtractedQuestion,
  extraction: { model: string; at: string },
): NewQuestion {
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

  // A leaf type chosen at cut time is not a hint: it is the operator's declared shape. The sole
  // exception is a comprehension container, where each child has an independently printed type.
  // For unbound/PYQ pages, retain the prompt-validated live-master key the model classified.
  const boundType = binding?.questionType ?? document.questionType;
  const aiType = normalizeQuestionType(draft.questionType);
  const lockedType = boundType && boundType !== 'comprehension' ? boundType : null;
  const questionType = draft.passageId !== null
    ? aiType && aiType !== 'comprehension'
      ? aiType
      : 'single_correct'
    : lockedType ?? (draft.match ? 'matrix' : aiType);
  // Do not let a hallucinated matrix payload override an operator-selected non-matrix type.
  const match = questionType === 'matrix' ? draft.match : null;
  // Difficulty is derived in the initial vision pass, so record its source independently of later
  // answer/solution merging. Older/custom prompt replies lack a score; 0.5 makes that absence visible
  // as neutral confidence instead of pretending the model reported certainty.
  const aiFilled: AiFilled | null = draft.level
    ? {
        level: {
          model: extraction.model,
          confidence: draft.difficultyConfidence ?? 0.5,
          at: extraction.at,
          via: 'extraction',
        },
      }
    : null;

  // A match-the-column question persists both the structured columns and (when printed) its A–D answer
  // choices. Those are different things: the canonical `answer` for a choice-based matrix is the
  // selected choice label (for example "C"), while `match.key` retains the underlying mapping when it
  // is visible. A source table with no printed choice panel receives deterministic generated choices
  // ONLY after the complete key is known; incomplete/ambiguous tables retain their direct mapping for
  // Verify instead of gaining an invented correct answer.
  if (match) {
    const optionRows = draft.options.map(parseOption);
    const selectedLabels = normalizeAnswerLabels(draft.answer, optionRows);
    const hasPrintedChoices = optionRows.length > 0;
    // A separate answer key often carries the missing rows as `A→p; B→q`. Fold only those missing
    // rows into the table before validating/synthesizing — it must never overwrite an already-read row.
    const completedMatch = mergeMatrixKeyWithAnswer(match, draft.answer);
    const generated = hasPrintedChoices ? null : synthesizeMatrixChoiceOptions(completedMatch);
    const synthesized = generated?.status === 'generated' ? generated : null;
    const answer = synthesized
      ? synthesized.answer
      : draft.answer?.trim()
        ? canonicalOptionAnswer(draft.answer, selectedLabels, questionType)
        : !hasPrintedChoices && Object.keys(completedMatch.key).length > 0
          ? matchKeyToAnswer(completedMatch.key)
          : '';
    const options = synthesized?.options ?? optionRows.map(({ label, body }) => ({
      label,
      body,
      isCorrect: selectedLabels.has(label),
    }));
    return {
      documentId: document.id,
      questionNumber: draft.questionNumber,
      path: document.path,
      stem: draft.questionText,
      options,
      answer,
      match: completedMatch,
      passageId: draft.passageId,
      groupOrder: draft.groupOrder,
      explanation: draft.explanation,
      images: [],
      questionType,
      level: draft.level,
      aiFilled,
      // Matrix rows follow the same per-leaf section routing as every other type. Without the
      // binding here, a mixed assembled chapter published matrices under the unit fallback (for
      // example "All sections") while its other questions retained their actual section.
      sectionName: binding?.sectionName ?? document.sectionName ?? document.path.section,
      topic: binding?.topicName ?? null,
      className: document.className,
      subject: binding?.subject ?? null,
      ...pyq,
      sourceRegion: { page: draft.sourcePage, bbox: [0, 0, 1, 1] },
    };
  }

  const options = draft.options.map(parseOption);
  const answerLabels = normalizeAnswerLabels(draft.answer, options);
  return {
    documentId: document.id,
    questionNumber: draft.questionNumber,
    path: document.path,
    stem: draft.questionText,
    options: options.map(({ label, body }) => ({
      label,
      body,
      isCorrect: answerLabels.has(label),
    })),
    answer: canonicalOptionAnswer(draft.answer, answerLabels, questionType),
    match: null,
    passageId: draft.passageId,
    groupOrder: draft.groupOrder,
    explanation: draft.explanation,
    images: [],
    questionType,
    level: draft.level,
    aiFilled,
    sectionName: binding?.sectionName ?? document.sectionName ?? document.path.section,
    topic: binding?.topicName ?? null,
    className: document.className,
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
    // Page progress can reach 100% while answer mapping or persistence is still running. Keep the
    // active stage so a terminal job tells the operator exactly which part failed.
    let stage = 'Preparing the PDF';

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
      stage = 'Question extraction';
      const { questions: drafts, usage } = await this.extractor.extractQuestions({
        pages,
        document,
        signal: controller.signal,
        onProgress: (progress) => this.writeProgress(jobId, progress),
      });
      await this.recordUsage(document, usage);
      stage = 'Answer and solution mapping';
      const answered = await this.applyAnswers(document, drafts, controller.signal);
      // Mapping is enrichment, whereas the question pass is the expensive, essential result. A
      // user cancellation must still stop everything, but a deadline that lands after every question
      // page was read must not discard those questions (and the tokens spent on them). Persist the
      // questions with a clear warning that some answer/solution enrichment may be absent.
      const mappingTimedOut = controller.signal.aborted && controller.signal.reason === 'timeout';
      if (!mappingTimedOut) controller.signal.throwIfAborted();
      // Comprehension sub-questions that share a passage are materialized into ONE passage row + N
      // stamped sub-question rows AFTER answers are folded in, so each sub-question keeps its own
      // answer/explanation and carries its group's passageId + order. Passages are persisted alongside
      // the questions in one wholesale replace (passages first, so every passageId resolves).
      stage = 'Saving extracted questions';
      const { drafts: grouped, passages } = materializePassages(answered, documentId);
      const extraction = { model: usage.model, at: now() };
      const rows = grouped.map((draft) => toNewQuestion(document, draft, extraction));
      const count = await this.questions.replaceDocument(documentId, passages, rows);

      await this.documents.recordExtraction(documentId, { questionCount: count });
      await this.jobs.update(jobId, {
        status: 'succeeded',
        questionsFound: count,
        pagesDone: pages.length,
        ...(mappingTimedOut
          ? { error: `Answer and solution mapping timed out after ${String(this.timeoutMs)}ms. ${String(count)} question${count === 1 ? '' : 's'} were saved, but some answers or solutions may be missing.` }
          : {}),
        finishedAt: now(),
      });
      logger.info({ documentId, questionsFound: count, mappingTimedOut }, 'Extraction complete');
    } catch (error) {
      // Document returns to a re-runnable state whether the run failed, timed out, or was cancelled.
      await this.documents.updateStatus(documentId, 'failed');
      if (controller.signal.aborted && controller.signal.reason === 'cancelled') {
        await this.jobs.update(jobId, { status: 'cancelled', finishedAt: now() });
        logger.info({ documentId }, 'Extraction cancelled');
      } else {
        const reason = controller.signal.aborted
          ? errors.extractionTimedOut(this.timeoutMs).message
          : error instanceof Error
            ? error.message
            : String(error);
        const message = `${stage} failed: ${reason}`;
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
    // Inline papers carry every answer/solution immediately after its question. They must be a
    // closed extraction boundary: a stale or accidentally uploaded sibling key from the same session
    // must never overwrite the inline data the question pass already read.
    if (document.answerLayout === 'inline') return drafts;
    if (!document.sessionId) return drafts;
    const siblings = await this.documents.listBySession(document.sessionId);
    const answerDocs = siblings.filter((s) => s.kind === 'answer' && sameGroup(s, document));
    const solutionDocs = siblings.filter((s) => s.kind === 'solution' && sameGroup(s, document));
    const companionDocs = siblings.filter((s) => s.kind === 'companion' && sameGroup(s, document));
    if (document.answerLayout === 'combined') {
      if (companionDocs.length === 0) return drafts;
      const hasCompanionRanges = document.topics.some((topic) =>
        topic.types.some((block) => block.companionPageRange !== undefined),
      );
      const sheets: AnswerSheet[] = [];
      for (const companionDoc of companionDocs) {
        if (hasCompanionRanges) {
          await this.collectTopicSheets(companionDoc, document.topics, 'companion', sheets, (pages, scope) =>
            this.extractor.extractCompanion({ pages, document: companionDoc, scope, signal }),
          );
        } else {
          await this.collectSheets(companionDoc, sheets, (pages) =>
            this.extractor.extractCompanion({ pages, document: companionDoc, signal }),
          );
        }
      }
      return mergeAnswers(drafts, sheets, document.topics);
    }
    if (answerDocs.length === 0 && solutionDocs.length === 0) return drafts;

    // v2 assembled uploads pin each topic's answer/solution pages, so we read every topic's key from
    // exactly its own pages and tag it with the topic name — the drag binding decides the match, not a
    // section-name-and-number guess. Legacy uploads (no ranges) keep the whole-PDF path unchanged.
    // Answer and solution bindings are independent. A chapter can, for example, bind answer-key
    // ranges while keeping a legacy whole-document solution PDF. Using one combined `hasRanges` flag
    // used to skip that solution PDF entirely.
    const hasAnswerRanges = document.topics.some((topic) =>
      topic.types.some((block) => block.answerPageRange !== undefined),
    );
    const hasSolutionRanges = document.topics.some((topic) =>
      topic.types.some((block) => block.solutionPageRange !== undefined),
    );

    const sheets: AnswerSheet[] = [];
    if (hasAnswerRanges) {
      for (const answerDoc of answerDocs) {
        await this.collectTopicSheets(answerDoc, document.topics, 'answer', sheets, (pages, scope) =>
          this.extractor.extractAnswers({ pages, document: answerDoc, scope, signal }),
        );
      }
    } else {
      for (const answerDoc of answerDocs) {
        await this.collectSheets(answerDoc, sheets, (pages) =>
          this.extractor.extractAnswers({ pages, document: answerDoc, signal }),
        );
      }
    }
    if (hasSolutionRanges) {
      for (const solutionDoc of solutionDocs) {
        await this.collectTopicSheets(solutionDoc, document.topics, 'solution', sheets, (pages, scope) =>
          this.extractor.extractSolutions({ pages, document: solutionDoc, scope, signal }),
        );
      }
    } else {
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
    kind: 'answer' | 'solution' | 'companion',
    sink: AnswerSheet[],
    extract: (
      pages: Awaited<ReturnType<PdfRasterizer['rasterize']>>,
      scope: AnswerExtractionScope,
    ) => Promise<AnswerExtraction>,
  ): Promise<void> {
    try {
      const pdf = await this.drive.downloadPdf(source.driveFileId);
      const pages = await this.rasterizer.rasterize(pdf);
      for (const topic of topics) {
        for (const block of topic.types) {
          const range = kind === 'answer'
            ? block.answerPageRange
            : kind === 'solution'
              ? block.solutionPageRange
              : block.companionPageRange;
          if (!range) continue;
          const slice = pages.filter((page) => page.pageNumber >= range.from && page.pageNumber <= range.to);
          if (slice.length === 0) continue;
          // The source sibling carries no topic map and, for an assembled chapter, its document-level
          // type is merely the first question leaf's type. Carry the matched question leaf explicitly
          // so its answer/solution pages always receive the correct type-specific prompt grammar.
          const scope: AnswerExtractionScope = {
            sectionName: topic.name,
            questionType: block.questionType ?? null,
            ...(topic.subject ? { subject: topic.subject } : {}),
            questionPageRange: block.pageRange,
            sourcePageRange: range,
          };
          const result = await extract(slice, scope);
          await this.recordUsage(source, result.usage);
          // Fold every entry this range produced under the topic's own name. A solution may cross a
          // page boundary, so a later non-duplicate explanation is a continuation, not a value to drop.
          const entries: Record<string, AnswerEntry> = {};
          for (const sheet of result.sheets) {
            for (const [number, entry] of Object.entries(sheet.entries)) {
              entries[number] = mergeAnswerEntries(entries[number], entry);
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
