import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { BankQuestion, UpdateBankImage } from '@ingest/contracts';
import { bankApi } from '../api/bank.api.js';

/** Searches the published bank; idle until a non-empty query is submitted. */
export function useBankSearch(query: string): UseQueryResult<BankQuestion[]> {
  return useQuery({
    queryKey: ['bank-search', query],
    queryFn: () => bankApi.search(query),
    enabled: query.trim().length > 0,
  });
}

/** Re-points one image on a published question, then refreshes the search results. */
export function useUpdateBankImage(): UseMutationResult<
  BankQuestion,
  Error,
  { questionId: string; patch: UpdateBankImage }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { questionId: string; patch: UpdateBankImage }) =>
      bankApi.updateImage(input.questionId, input.patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-search'] });
    },
  });
}
