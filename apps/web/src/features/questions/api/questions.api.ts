import { z } from 'zod';
import type { DetectedFigures, Question, UpdateQuestion } from '@ingest/contracts';
import {
  DetectedFiguresSchema,
  PublishResultSchema,
  QuestionSchema,
  RefinedLatexSchema,
  UploadedImageSchema,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import { config } from '../../../config/env.js';

const QuestionListSchema = z.array(QuestionSchema);
const PageCountSchema = z.object({ pages: z.number().int().nonnegative() });

/** Feature-scoped calls to the questions + pages endpoints. The only place this feature hits the network. */
export const questionsApi = {
  listByDocument: (documentId: string): Promise<Question[]> => {
    const query = new URLSearchParams({ documentId });
    return request(`/questions?${query.toString()}`, { schema: QuestionListSchema });
  },

  update: (id: string, patch: UpdateQuestion): Promise<Question> => {
    return request(`/questions/${id}`, { method: 'PATCH', body: patch, schema: QuestionSchema });
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
  uploadImage: (questionId: string, name: string, blob: Blob): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('name', name);
    form.append('file', blob, `${name}.png`);
    return request(`/questions/${questionId}/images`, {
      method: 'POST',
      body: form,
      schema: UploadedImageSchema,
    });
  },

  /** Publish this document's questions into the main bank; returns how many rows were inserted. */
  publishDocument: (documentId: string): Promise<{ published: number }> => {
    return request(`/publish/documents/${documentId}`, {
      method: 'POST',
      schema: PublishResultSchema,
    });
  },

  pageCount: async (documentId: string): Promise<number> => {
    const result = await request(`/pages/${documentId}/count`, { schema: PageCountSchema });
    return result.pages;
  },

  /** Direct <img src> URL for a document's rendered page (same-origin, proxied to the API). */
  pageImageUrl: (documentId: string, page: number): string =>
    `${config.apiBaseUrl}/pages/${documentId}/${String(page)}`,
};
