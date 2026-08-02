import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { documentsApi } from '../api/documents.api.js';

type DocumentList = Awaited<ReturnType<typeof documentsApi.list>>;

/** Loads the list of pipeline documents for the Drive-backed dropdown. */
export function useDocuments(): UseQueryResult<DocumentList> {
  return useQuery({
    queryKey: ['documents'],
    queryFn: () => documentsApi.list(),
  });
}
