import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import type { ChapterUploadMetadata, UploadChapterResponse } from '@ingest/contracts';
import { ingestionApi } from '../api/ingestion.api.js';

export type UploadChapterInput = {
  pdfBytes: Uint8Array;
  metadata: ChapterUploadMetadata;
};

/** Uploads one built chapter PDF (question or answer) to its Drive folder. */
export function useUploadChapter(): UseMutationResult<
  UploadChapterResponse,
  Error,
  UploadChapterInput
> {
  return useMutation({
    mutationFn: (input: UploadChapterInput) =>
      ingestionApi.uploadChapter(input.pdfBytes, input.metadata),
  });
}
