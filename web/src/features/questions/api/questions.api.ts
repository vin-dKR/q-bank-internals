import { z } from 'zod';
import type {
  BatchUpdateQuestionsResult,
  DetectedFigures,
  DetectedFiguresBatch,
  Passage,
  Question,
  QuestionBatchUpdate,
  QuestionListResponse,
  ReExtractedGroup,
  ReExtractedQuestion,
  ReExtractSource,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';
import {
  BatchUpdateQuestionsResultSchema,
  DetectedFiguresBatchSchema,
  DetectedFiguresSchema,
  PassageSchema,
  PublishResultSchema,
  QuestionListResponseSchema,
  QuestionSchema,
  ReExtractedGroupSchema,
  ReExtractedQuestionSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import { uploadCrop } from '../../../shared/api/upload-crop.js';
import { fetchPageCount, pageImageUrl } from '../../../shared/api/pages.js';
import { refineLatex } from '../../../shared/api/refine.js';

const OkSchema = z.object({ ok: z.boolean() });

/** Feature-scoped calls to the questions + pages endpoints. The only place this feature hits the network. */
export const questionsApi = {
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
    return request(`/questions/passages/${id}`, { method: 'PATCH', body: patch, schema: PassageSchema });
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
  detectFigures: (documentId: string, page: number): Promise<DetectedFigures> => {
    return request('/questions/detect-figures', {
      method: 'POST',
      body: { documentId, page },
      schema: DetectedFiguresSchema,
    });
  },

  /**
   * AI-locate figures on several pages in one request (the whole-document detect). Send at most
   * `DETECT_FIGURES_MAX_PAGES` pages per call; pages without extracted questions are skipped
   * server-side. Each returned page carries `ok` — a page whose vision call failed comes back as
   * `ok: false` with its error instead of failing the whole request.
   */
  detectFiguresBatch: (documentId: string, pages: number[]): Promise<DetectedFiguresBatch> => {
    return request('/questions/detect-figures/batch', {
      method: 'POST',
      body: { documentId, pages },
      schema: DetectedFiguresBatchSchema,
    });
  },

  /** One-click AI "Fix LaTeX": returns the text with math wrapped in \(...\). */
  refine: (text: string): Promise<string> => refineLatex(text),

  /**
   * AI "read the page again": re-extract one question's fields (stem, options, answer, explanation)
   * straight from a source page image — the companion to {@link refine}, which only cleans text.
   * `source` redirects the read to the sibling answer/solution document + this topic's page, so an
   * answer/explanation re-read reads that PDF; omit it to read the question's own page.
   */
  reExtract: (
    documentId: string,
    questionId: string,
    source?: ReExtractSource,
    questionType?: string | null,
  ): Promise<ReExtractedQuestion> => {
    return request('/questions/re-extract', {
      method: 'POST',
      body: {
        documentId,
        questionId,
        ...(source ? { source } : {}),
        ...(questionType ? { questionType } : {}),
      },
      schema: ReExtractedQuestionSchema,
    });
  },

  /**
   * AI "re-read the whole passage": re-extract a comprehension group's shared passage and every
   * sub-question in one call, addressed by the group's `passageId`. Returns the passage (to apply to
   * the group's passage record) and the per-sub-question fields, each already matched to the
   * `questionId` it should update. `source` redirects the read to a sibling answer/solution page
   * exactly like {@link reExtract}.
   */
  reExtractGroup: (
    documentId: string,
    passageId: string,
    source?: ReExtractSource,
    questionType?: string | null,
  ): Promise<ReExtractedGroup> => {
    return request('/questions/re-extract-group', {
      method: 'POST',
      body: {
        documentId,
        passageId,
        ...(source ? { source } : {}),
        ...(questionType ? { questionType } : {}),
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

  pageCount: (documentId: string): Promise<number> => fetchPageCount(documentId),

  /** Direct <img src> URL for a document's rendered page (same-origin, proxied to the API). */
  pageImageUrl: (documentId: string, page: number): string => pageImageUrl(documentId, page),
};
