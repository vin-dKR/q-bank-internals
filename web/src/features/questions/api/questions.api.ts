import { z } from 'zod';
import type {
  BatchUpdateQuestionsResult,
  DetectedFigures,
  DetectedFiguresBatch,
  Question,
  QuestionBatchUpdate,
  UpdateQuestion,
} from '@ingest/contracts';
import {
  BatchUpdateQuestionsResultSchema,
  DetectedFiguresBatchSchema,
  DetectedFiguresSchema,
  PublishResultSchema,
  QuestionSchema,
  RefinedLatexSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import { uploadCrop } from '../../../shared/api/upload-crop.js';
import { fetchPageCount, pageImageUrl } from '../../../shared/api/pages.js';

const QuestionListSchema = z.array(QuestionSchema);

/** Feature-scoped calls to the questions + pages endpoints. The only place this feature hits the network. */
export const questionsApi = {
  listByDocument: (documentId: string): Promise<Question[]> => {
    const query = new URLSearchParams({ documentId });
    return request(`/questions?${query.toString()}`, { schema: QuestionListSchema });
  },

  update: (id: string, patch: UpdateQuestion): Promise<Question> => {
    return request(`/questions/${id}`, { method: 'PATCH', body: patch, schema: QuestionSchema });
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
  refine: async (text: string): Promise<string> => {
    const result = await request('/questions/refine', {
      method: 'POST',
      body: { text },
      schema: RefinedLatexSchema,
    });
    return result.text;
  },

  /** Upload one cropped image under `name`; returns the public URL to save on the question. */
  uploadImage: (questionId: string, name: string, blob: Blob): Promise<{ url: string }> =>
    uploadCrop(questionId, name, blob),

  /** Publish this document's questions into the main bank; returns how many rows were inserted. */
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
