import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { Document } from '@ingest/contracts';
import { documentsApi } from '../api/documents.api.js';

/** Loads a single document (used by Verify for its question-type / section fallback). */
export function useDocument(id: string | null): UseQueryResult<Document> {
  return useQuery({
    queryKey: ['document', id],
    queryFn: () => documentsApi.get(id ?? ''),
    enabled: id !== null,
  });
}
