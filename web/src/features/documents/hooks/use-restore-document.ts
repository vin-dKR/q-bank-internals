import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Document } from '@ingest/contracts';
import { documentsApi } from '../api/documents.api.js';

/**
 * Restore a soft-deleted document (and its session) so it reappears in the pipeline — the "get the
 * session back" path used when a published question is edited. Silent (no toast): it fires
 * automatically on arriving in Verify from an Edit link and is a harmless no-op for live documents.
 */
export function useRestoreDocument(): UseMutationResult<Document, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.restore(id),
    onSuccess: (document) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['document', document.id] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
