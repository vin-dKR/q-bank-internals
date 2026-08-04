import type { Document, QuestionOption } from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import type { DocumentRepository } from '../documents/index.js';
import type { NewQuestion, QuestionRepository } from '../questions/index.js';
import type { DriveService } from '../drive/index.js';
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
    images: [],
    questionType: document.questionType,
    sectionName: document.sectionName ?? document.path.section,
    topic: null,
    sourceRegion: { page: draft.sourcePage, bbox: [0, 0, 1, 1] },
  };
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
      const drafts = await this.extractor.extractQuestions({ pages, document });
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

  /** Extract + merge answers from the sibling answer/solution PDF(s) in the same session + section. */
  private async applyAnswers(
    document: Document,
    drafts: ExtractedQuestion[],
  ): Promise<ExtractedQuestion[]> {
    if (!document.sessionId) return drafts;
    const siblings = await this.documents.listBySession(document.sessionId);
    const answerDocs = siblings.filter(
      (sibling) =>
        (sibling.kind === 'answer' || sibling.kind === 'solution') &&
        sibling.sectionName === document.sectionName,
    );
    if (answerDocs.length === 0) return drafts;

    const sheets: AnswerSheet[] = [];
    for (const answerDoc of answerDocs) {
      try {
        const pdf = await this.drive.downloadPdf(answerDoc.driveFileId);
        const pages = await this.rasterizer.rasterize(pdf);
        sheets.push(...(await this.extractor.extractAnswers({ pages, document: answerDoc })));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { answerDoc: answerDoc.id, err: message },
          'Answer extraction failed; keeping questions unanswered',
        );
      }
    }
    return mergeAnswers(drafts, sheets);
  }
}
