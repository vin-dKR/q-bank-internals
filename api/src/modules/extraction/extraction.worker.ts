import type { Document, QuestionOption } from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import type { DocumentRepository } from '../documents/index.js';
import type { NewQuestion, QuestionRepository } from '../questions/index.js';
import type { DriveService } from '../drive/index.js';
import type { AiTokenUsage, UsageService } from '../usage/index.js';
import type { ExtractionJobStore } from './extraction.repository.js';
import type { ExtractionJobPayload } from './job-queue.js';
import type { PdfRasterizer } from './pdf-rasterizer.js';
import type {
  AnswerEntry,
  AnswerExtraction,
  AnswerSheet,
  ExtractedQuestion,
  VisionExtractor,
} from './vision-extractor.js';
import { collapseComprehension } from './collapse-comprehension.js';
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

/**
 * Map a model draft into the persisted Question shape (§6.1: the contract shape is canonical).
 * Topic + question type come from the operator's cut-time config when the draft's source page is
 * covered by a block — a deterministic mapping, so the model can never mislabel a type.
 */
function toNewQuestion(document: Document, draft: ExtractedQuestion): NewQuestion {
  const options = draft.options.map(parseOption);
  const answerLabel = normalizeAnswerLabel(draft.answer, options);
  const binding = topicBindingForPage(document.topics, draft.sourcePage);
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
    explanation: draft.explanation,
    images: [],
    questionType: binding?.questionType ?? document.questionType,
    sectionName: document.sectionName ?? document.path.section,
    topic: binding?.topicName ?? null,
    sourceRegion: { page: draft.sourcePage, bbox: [0, 0, 1, 1] },
  };
}

/** True when two documents describe the same chapter unit (module + chapter + section). */
function sameUnit(a: Document, b: Document): boolean {
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

    try {
      const pdf = await this.drive.downloadPdf(document.driveFileId);
      const pages = await this.rasterizer.rasterize(pdf);
      const { questions: drafts, usage } = await this.extractor.extractQuestions({ pages, document });
      await this.recordUsage(document, usage);
      const answered = await this.applyAnswers(document, drafts);
      // Comprehension sub-questions are merged into one question per passage AFTER answers are folded
      // in, so each sub-question's answer/explanation is already on it before they combine.
      const collapsed = collapseComprehension(answered);
      const rows = collapsed.map((draft) => toNewQuestion(document, draft));
      const count = await this.questions.replaceForDocument(documentId, rows);

      await this.documents.recordExtraction(documentId, { questionCount: count });
      await this.jobs.update(jobId, {
        status: 'succeeded',
        questionsFound: count,
        finishedAt: now(),
      });
      logger.info({ documentId, questionsFound: count }, 'Extraction complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.documents.updateStatus(documentId, 'failed');
      await this.jobs.update(jobId, { status: 'failed', error: message, finishedAt: now() });
      logger.error({ documentId, err: message }, 'Extraction failed');
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
  ): Promise<ExtractedQuestion[]> {
    if (!document.sessionId) return drafts;
    const siblings = await this.documents.listBySession(document.sessionId);
    const answerDocs = siblings.filter((s) => s.kind === 'answer' && sameUnit(s, document));
    const solutionDocs = siblings.filter((s) => s.kind === 'solution' && sameUnit(s, document));
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
          this.extractor.extractAnswers({ pages, document: answerDoc }),
        );
      }
      for (const solutionDoc of solutionDocs) {
        await this.collectTopicSheets(solutionDoc, document.topics, 'solution', sheets, (pages) =>
          this.extractor.extractSolutions({ pages, document: solutionDoc }),
        );
      }
    } else {
      for (const answerDoc of answerDocs) {
        await this.collectSheets(answerDoc, sheets, (pages) =>
          this.extractor.extractAnswers({ pages, document: answerDoc }),
        );
      }
      for (const solutionDoc of solutionDocs) {
        await this.collectSheets(solutionDoc, sheets, (pages) =>
          this.extractor.extractSolutions({ pages, document: solutionDoc }),
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
