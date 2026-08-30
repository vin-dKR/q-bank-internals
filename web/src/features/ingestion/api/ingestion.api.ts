import type { ChapterUploadMetadata, PaperMetadata, UploadChapterResponse } from '@ingest/contracts';
import { ExtractPaperMetadataResultSchema, UploadChapterResponseSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

/** Feature-scoped call to the ingestion endpoint. The only place this feature hits the network. */
export const ingestionApi = {
  uploadChapter: (
    pdfBytes: Uint8Array,
    metadata: ChapterUploadMetadata,
  ): Promise<UploadChapterResponse> => {
    const form = new FormData();
    const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
    form.append('pdf', blob, `${metadata.chapter}-${metadata.kind}.pdf`);
    form.append('metadata', JSON.stringify(metadata));
    return request('/ingestion', {
      method: 'POST',
      body: form,
      schema: UploadChapterResponseSchema,
    });
  },

  /**
   * AI-fill the PYQ paper-details form: send a rendered header-page PNG to the vision endpoint and get
   * back the whole-paper metadata it could read. Used pre-upload, so it posts the image directly
   * rather than referencing a stored document.
   */
  extractPaperMetadata: async (headerPng: Blob): Promise<PaperMetadata> => {
    const form = new FormData();
    form.append('file', headerPng, 'paper-header.png');
    const result = await request('/questions/paper-metadata', {
      method: 'POST',
      body: form,
      schema: ExtractPaperMetadataResultSchema,
    });
    return result.paper;
  },
};
