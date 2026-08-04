import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsApi } from '../api/documents.api.js';

/** Deletes a document (and its extracted questions), then refreshes documents + sessions. */
export function useDeleteDocument(): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
