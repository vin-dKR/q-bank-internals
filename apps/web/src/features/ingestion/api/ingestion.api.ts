import type { ChapterUploadMetadata, UploadChapterResponse } from '@ingest/contracts';
import { UploadChapterResponseSchema } from '@ingest/contracts';
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
};
