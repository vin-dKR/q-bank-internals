import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type DocumentListParams, documentsApi } from '../api/documents.api.js';

type DocumentList = Awaited<ReturnType<typeof documentsApi.list>>;

/**
 * Loads pipeline documents, optionally filtered by session and/or status. Auto-polls every 2s while
 * any document is queued/extracting, so the status table updates live during Phase 2, then stops.
 */
export function useDocuments(params: DocumentListParams = {}): UseQueryResult<DocumentList> {
  return useQuery({
    queryKey: ['documents', params.sessionId ?? null, params.status ?? null],
    queryFn: () => documentsApi.list(params),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const active = items.some((doc) => doc.status === 'queued' || doc.status === 'extracting');
      return active ? 2000 : false;
    },
  });
}
