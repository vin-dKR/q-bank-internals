import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type DocumentListParams, documentsApi } from '../api/documents.api.js';

type DocumentList = Awaited<ReturnType<typeof documentsApi.list>>;

/**
 * Loads pipeline documents, optionally filtered by session and/or status. Auto-polls every 2s while
 * any document is queued/extracting, so the status table updates live during Phase 2, then stops.
 * `enabled` gates the fetch — callers that only want session-scoped results pass `false` when they
 * have no session to scope by, so an unscoped all-documents fetch is never issued. `idlePollMs` keeps a
 * slow poll running even when nothing is active, so a view that must notice a run STARTING elsewhere
 * (another operator, or a serverless request that hasn't returned yet) converges on the shared state.
 */
export function useDocuments(
  params: DocumentListParams = {},
  options: { enabled?: boolean; idlePollMs?: number } = {},
): UseQueryResult<DocumentList> {
  return useQuery({
    queryKey: ['documents', params.sessionId ?? null, params.status ?? null],
    queryFn: () => documentsApi.list(params),
    enabled: options.enabled ?? true,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const active = items.some((doc) => doc.status === 'queued' || doc.status === 'extracting');
      return active ? 2000 : (options.idlePollMs ?? false);
    },
  });
}
