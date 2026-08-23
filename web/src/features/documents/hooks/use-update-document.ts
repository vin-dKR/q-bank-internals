import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Document, UpdateDocument } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { documentsApi } from '../api/documents.api.js';

/** Edits a document (currently the manual-fix flag), then refreshes documents + sessions views. */
export function useUpdateDocument(): UseMutationResult<
  Document,
  Error,
  { id: string; patch: UpdateDocument }
> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateDocument }) =>
      documentsApi.update(input.id, input.patch),
    onSuccess: (document) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['document', document.id] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => { error('Could not update file', err.message); },
  });
}
