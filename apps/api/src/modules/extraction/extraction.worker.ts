import type { Document, QuestionOption } from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import type { DocumentRepository } from '../documents/index.js';
import type { NewQuestion, QuestionRepository } from '../questions/index.js';
import type { DriveService } from '../drive/index.js';
import type { AiTokenUsage, UsageService } from '../usage/index.js';
import type { ExtractionJobStore } from './extraction.repository.js';
import type { ExtractionJobPayload } from './job-queue.js';
import type { PdfRasterizer } from './pdf-rasterizer.js';
import type { AnswerSheet, ExtractedQuestion, VisionExtractor } from './vision-extractor.js';
import { mergeAnswers } from './merge-answers.js';

/** Statuses that mean "don't touch it" — the guard that makes re-running a job idempotent/resumable. */
const TERMINAL_OR_ACTIVE = new Set<Document['status']>(['extracting', 'extracted', 'completed']);

const OPTION_RE = /^\s*\(?([A-Da-d1-4])\)?[.)]?\s*([\s\S]*)$/;

/** Pull a single option letter (A–D) out of a raw answer string like "A", "(A)", or "1". */
function normalizeAnswerLabel(answer: string | null): string | null {
  if (!answer) return null;
  const match = /([A-Da-d1-4])/.exec(answer);
  if (!match) return null;
  const token = (match[1] ?? '').toUpperCase();
  return /[1-4]/.test(token) ? String.fromCharCode(64 + Number(token)) : token;
}

/** Parse "(A) body" (or "1. body") into a labelled option, marking it correct against the key. */
function parseOption(raw: string, index: number, answerLabel: string | null): QuestionOption {
  const match = OPTION_RE.exec(raw);
  let label = String.fromCharCode(65 + index); // A, B, C, D fallback by position
  let body = raw.trim();
  if (match) {
    const token = (match[1] ?? '').toUpperCase();
    label = /[1-4]/.test(token) ? String.fromCharCode(64 + Number(token)) : token;
    body = (match[2] ?? '').trim();
  }
  return { label, body, isCorrect: answerLabel !== null && label === answerLabel };
}

/** Map a model draft into the persisted Question shape (§6.1: the contract shape is canonical). */
function toNewQuestion(document: Document, draft: ExtractedQuestion): NewQuestion {
  const answerLabel = normalizeAnswerLabel(draft.answer);
  return {
    documentId: document.id,
    path: document.path,
    stem: draft.questionText,
    options: draft.options.map((option, index) => parseOption(option, index, answerLabel)),
    answer: draft.answer ?? '',
    explanation: draft.explanation,
    images: [],
    questionType: document.questionType,
    sectionName: document.sectionName ?? document.path.section,
    topic: null,
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
      const rows = answered.map((draft) => toNewQuestion(document, draft));
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
   * Both are folded into the drafts by (section, question number). Sheets are ordered answers-first
   * so a solution PDF's answer only fills gaps the answer sheet left — the answer sheet stays canonical.
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

    const sheets: AnswerSheet[] = [];
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
    return mergeAnswers(drafts, sheets);
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
