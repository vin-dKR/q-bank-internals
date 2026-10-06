import { z } from 'zod';
import type {
  BatchUpdateQuestionsResult,
  DetectedFigures,
  DetectedFiguresBatch,
  LatexFixResult,
  LatexFieldCheckResult,
  LatexScan,
  PublishIssues,
  ReExtractGroupMode,
  DetectFiguresSource,
  Passage,
  Question,
  QuestionBatchUpdate,
  QuestionListResponse,
  ReExtractedGroup,
  ReExtractedQuestion,
  ReExtractSource,
  ReExtractSupportingSources,
  TranscribeAreaTarget,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';
import {
  BatchUpdateQuestionsResultSchema,
  DetectedFiguresBatchSchema,
  DetectedFiguresSchema,
  LatexFixResultSchema,
  LatexFieldCheckResultSchema,
  LatexScanSchema,
  PublishIssuesSchema,
  PassageSchema,
  PublishResultSchema,
  QuestionListResponseSchema,
  QuestionSchema,
  ReExtractedGroupSchema,
  ReExtractedQuestionSchema,
  TranscribedAreaSchema,
  TranscribeQuestionRegionResponseSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import { uploadCrop } from '../../../shared/api/upload-crop.js';
import { fetchPageCount, pageImageUrl } from '../../../shared/api/pages.js';
import { refineLatex } from '../../../shared/api/refine.js';

const OkSchema = z.object({ ok: z.boolean() });

/** Options for a comprehension re-read. The explicit mode prevents a passage correction from overwriting children. */
export type ReExtractGroupOptions = {
  source?: ReExtractSource;
  /** Legacy callers may still send this; the API uses it only when a stored child has no type. */
  questionType?: string | null;
  mode?: ReExtractGroupMode;
};

/** Feature-scoped calls to the questions + pages endpoints. The only place this feature hits the network. */
export const questionsApi = {
  /** Automatically re-check staged questions after extraction and after Verify edits. */
  scanLatex: (documentId: string): Promise<LatexScan> =>
    request(`/questions/latex-scan?${new URLSearchParams({ documentId }).toString()}`, { schema: LatexScanSchema }),
  checkLatexField: (field: string, text: string): Promise<LatexFieldCheckResult> =>
    request('/questions/latex-check-field', {
      method: 'POST', body: { field, text }, schema: LatexFieldCheckResultSchema,
    }),
  fixLatexAutomatically: (documentId: string): Promise<LatexFixResult> =>
    request('/questions/latex-fix/automatic', {
      method: 'POST', body: { documentId }, schema: LatexFixResultSchema,
    }),
  fixLatexWithAi: (documentId: string, keys: string[]): Promise<LatexFixResult> =>
    request('/questions/latex-fix/ai', {
      method: 'POST', body: { documentId, keys }, schema: LatexFixResultSchema,
    }),
  /** A document's extracted questions PLUS the comprehension passages they reference (verify/preview). */
  listByDocument: (documentId: string): Promise<QuestionListResponse> => {
    const query = new URLSearchParams({ documentId });
    return request(`/questions?${query.toString()}`, { schema: QuestionListResponseSchema });
  },

  update: (id: string, patch: UpdateQuestion): Promise<Question> => {
    return request(`/questions/${id}`, { method: 'PATCH', body: patch, schema: QuestionSchema });
  },

  /** Delete one question (verify "Delete") — removes it from this unit and its published bank copy. */
  remove: async (id: string): Promise<void> => {
    await request(`/questions/${id}`, { method: 'DELETE', schema: OkSchema });
  },

  /** Apply verify-screen edits (text / shared image) to one comprehension passage — a single PATCH. */
  updatePassage: (id: string, patch: UpdatePassage): Promise<Passage> => {
    return request(`/questions/passages/${id}`, {
      method: 'PATCH',
      body: patch,
      schema: PassageSchema,
    });
  },

  /** Manually group the given questions into a new comprehension passage; returns the created passage. */
  groupQuestions: (documentId: string, questionIds: string[]): Promise<Passage> => {
    return request('/questions/group', {
      method: 'POST',
      body: { documentId, questionIds },
      schema: PassageSchema,
    });
  },

  /** Dissolve a comprehension group back into standalone questions. */
  ungroupPassage: async (passageId: string): Promise<void> => {
    await request(`/questions/passages/${passageId}`, { method: 'DELETE', schema: OkSchema });
  },

  /** Push several questions' verify edits in one call; returns per-question success/failure. */
  batchUpdate: (updates: QuestionBatchUpdate[]): Promise<BatchUpdateQuestionsResult> => {
    return request('/questions/batch', {
      method: 'PATCH',
      body: { updates },
      schema: BatchUpdateQuestionsResultSchema,
    });
  },

  /**
   * AI-locate the figures on one page of a document. Returns each figure's bbox in the page image's
   * natural pixels (plus the page's size), mapped to the question it belongs to — the client crops
   * those regions out of the same page image and uploads them via {@link uploadImage}.
   */
  detectFigures: (
    documentId: string,
    page: number,
    source?: DetectFiguresSource,
  ): Promise<DetectedFigures> => {
    return request('/questions/detect-figures', {
      method: 'POST',
      body: { documentId, page, ...(source ? { source } : {}) },
      schema: DetectedFiguresSchema,
    });
  },

  /**
   * AI-locate figures on several pages in one request (the whole-document detect). Send at most
   * `DETECT_FIGURES_MAX_PAGES` pages per call. An optional sibling source scans Answer/Solution pages
   * while `documentId` remains the question-owner document. Each returned page carries `ok` — a page
   * whose vision call failed comes back as `ok: false` with its error instead of failing the request.
   */
  detectFiguresBatch: (
    documentId: string,
    pages: number[],
    source?: DetectFiguresSource,
  ): Promise<DetectedFiguresBatch> => {
    return request('/questions/detect-figures/batch', {
      method: 'POST',
      body: { documentId, pages, ...(source ? { source } : {}) },
      schema: DetectedFiguresBatchSchema,
    });
  },

  /** One-click AI "Fix LaTeX": returns the text with math wrapped in \(...\). */
  refine: (text: string): Promise<string> => refineLatex(text),

  /** AI-read a teacher-selected source rectangle, without scanning/replacing the whole question. */
  transcribeArea: async (
    documentId: string,
    target: TranscribeAreaTarget,
    blob: Blob,
  ): Promise<string> => {
    const form = new FormData();
    form.append('documentId', documentId);
    form.append('target', target);
    form.append('file', blob, 'selected-source-area.png');
    const result = await request('/questions/transcribe-area', {
      method: 'POST',
      body: form,
      schema: TranscribedAreaSchema,
    });
    return result.text;
  },

  /**
   * AI "read the page again": re-extract one question's fields (stem, options, answer, explanation)
   * straight from a source page image — the companion to {@link refine}, which only cleans text.
   * `source` redirects the read to one explicit source page for a field-level re-read.
   * `supportingSources` asks a whole selected-question re-read to merge the matching answer and
   * solution pages while keeping stem/options exclusively from the question page.
   */
  reExtract: (
    documentId: string,
    questionId: string,
    source?: ReExtractSource,
    questionType?: string | null,
    supportingSources?: ReExtractSupportingSources,
  ): Promise<ReExtractedQuestion> => {
    return request('/questions/re-extract', {
      method: 'POST',
      body: {
        documentId,
        questionId,
        ...(source ? { source } : {}),
        ...(questionType ? { questionType } : {}),
        ...(supportingSources ? { supportingSources } : {}),
      },
      schema: ReExtractedQuestionSchema,
    });
  },

  /**
   * AI re-read for a comprehension group. `passage_only` changes only the shared passage; the explicit
   * `passage_and_questions` mode also returns each member's typed fields. The server maps every child
   * back to its existing `questionId`; `source` redirects the read to a sibling answer/solution page
   * exactly like {@link reExtract}.
   */
  reExtractGroup: (
    documentId: string,
    passageId: string,
    options: ReExtractGroupOptions = {},
  ): Promise<ReExtractedGroup> => {
    return request('/questions/re-extract-group', {
      method: 'POST',
      body: {
        documentId,
        passageId,
        ...(options.source ? { source: options.source } : {}),
        ...(options.questionType ? { questionType: options.questionType } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
      },
      schema: ReExtractedGroupSchema,
    });
  },

  /** Upload one cropped image under `name`; returns the public URL to save on the question. */
  uploadImage: (questionId: string, name: string, blob: Blob): Promise<{ url: string }> =>
    uploadCrop(questionId, name, blob),

  /** Sync saved questions into the bank; returns how many rows were inserted or changed. */
  publishDocument: (documentId: string): Promise<{ published: number }> => {
    return request(`/publish/documents/${documentId}`, {
      method: 'POST',
      schema: PublishResultSchema,
    });
  },

  /** Transcribe the exact region selected on a question PDF; returned text stays a local draft. */
  transcribeRegion: (
    questionId: string,
    input: {
      documentId: string;
      page: number;
      bbox: [number, number, number, number];
      destination: 'stem' | 'option' | 'answer' | 'solution';
      optionIndex?: number;
      source?: ReExtractSource;
    },
  ): Promise<{ text: string }> => request(`/questions/${questionId}/transcribe-region`, {
    method: 'POST', body: input, schema: TranscribeQuestionRegionResponseSchema,
  }),

  /** Lists question-level validation blockers before publishing or updating the bank. */
  publishIssues: (documentId: string): Promise<PublishIssues> =>
    request(`/publish/documents/${documentId}/issues`, { schema: PublishIssuesSchema }),

  pageCount: (documentId: string): Promise<number> => fetchPageCount(documentId),

  /** Direct <img src> URL for a document's rendered page (same-origin, proxied to the API). */
  pageImageUrl: (documentId: string, page: number): string => pageImageUrl(documentId, page),
};
