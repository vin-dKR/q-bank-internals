import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { BankQuestion } from '@ingest/contracts';
import { bankApi } from '../api/bank.api.js';

/** Searches the published bank; idle until a non-empty query is submitted. */
export function useBankSearch(query: string): UseQueryResult<BankQuestion[]> {
  return useQuery({
    queryKey: ['bank-search', query],
    queryFn: () => bankApi.search(query),
    enabled: query.trim().length > 0,
  });
}
