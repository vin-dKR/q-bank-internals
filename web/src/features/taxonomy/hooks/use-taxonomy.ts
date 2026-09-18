import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateDictionaryEntry,
  DictionaryEntry,
  DictionaryList,
  DictionaryQuery,
  SeedDictionary,
  TaxonomyDimension,
  UpdateDictionaryEntry,
} from '@ingest/contracts';
import { taxonomyApi } from '../api/taxonomy.api.js';

/** One dimension's dictionary, narrowed by an optional name substring + parent scope. */
export function useDictionary(
  dimension: TaxonomyDimension,
  query: DictionaryQuery,
  enabled = true,
): UseQueryResult<DictionaryList> {
  return useQuery({
    queryKey: ['masters', dimension, query.q ?? '', query.subjectId ?? '', query.chapterId ?? ''],
    queryFn: () => taxonomyApi.list(dimension, query),
    enabled,
  });
}

/** Every mutation refreshes the whole dimension (and, for scoped dims, any parent-filtered view). */
function useInvalidate(dimension: TaxonomyDimension): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['masters', dimension] });
  };
}

export function useCreateEntry(
  dimension: TaxonomyDimension,
): UseMutationResult<DictionaryEntry, Error, CreateDictionaryEntry> {
  const invalidate = useInvalidate(dimension);
  return useMutation({
    mutationFn: (body: CreateDictionaryEntry) => taxonomyApi.create(dimension, body),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry(
  dimension: TaxonomyDimension,
): UseMutationResult<DictionaryEntry, Error, { id: string; body: UpdateDictionaryEntry }> {
  const invalidate = useInvalidate(dimension);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDictionaryEntry }) =>
      taxonomyApi.update(dimension, id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry(
  dimension: TaxonomyDimension,
): UseMutationResult<{ ok: boolean }, Error, string> {
  const invalidate = useInvalidate(dimension);
  return useMutation({
    mutationFn: (id: string) => taxonomyApi.remove(dimension, id),
    onSuccess: invalidate,
  });
}

export function useSeedDimension(
  dimension: TaxonomyDimension,
): UseMutationResult<SeedDictionary, Error, void> {
  const invalidate = useInvalidate(dimension);
  return useMutation({
    mutationFn: () => taxonomyApi.seed(dimension),
    onSuccess: invalidate,
  });
}
