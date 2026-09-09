import {
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { BankDeleteResult, BankFlagResult, BankTextResult, CatalogFilterOptions, CatalogPage, UpdateBankText } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { catalogApi } from '../api/catalog.api.js';
import type { CatalogFilterState, CatalogSelection } from '../types.js';

/** The shape react-query caches an infinite query under — the pages plus their cursors. */
type CatalogInfiniteData = { pages: CatalogPage[]; pageParams: unknown[] };

/**
 * The browse list: one cursor-paginated page per fetch, keyed by the whole active selection so any
 * filter or search change is its own cache bucket. `pageParam` is the id-cursor (null for page one).
 */
export function useCatalogQuestions(
  filters: CatalogFilterState,
): UseInfiniteQueryResult<{ pages: CatalogPage[] }> {
  return useInfiniteQuery({
    queryKey: ['catalog', filters],
    queryFn: ({ pageParam }) => catalogApi.list(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The cascading dropdown values for the current selection; stays fresh for 15 min like eduents. */
export function useFilterOptions(selection: CatalogSelection): UseQueryResult<CatalogFilterOptions> {
  return useQuery({
    queryKey: ['catalog-filter-options', selection],
    queryFn: () => catalogApi.filterOptions(selection),
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Toggle a published question's flag from the browse cards. Optimistic: patches the `flagged` field in
 * every cached browse page immediately (so the badge/button flip without a round-trip) and rolls back
 * on failure. Deliberately does NOT invalidate — an unflag under the "Flagged only" filter would rip
 * the card out mid-click; the operator's filter re-runs on the next real fetch.
 */
export function useSetCatalogFlag(): UseMutationResult<
  BankFlagResult,
  Error,
  { id: string; flagged: boolean },
  { previous: [readonly unknown[], CatalogInfiniteData | undefined][] }
> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: ({ id, flagged }) => catalogApi.setFlag(id, flagged),
    onMutate: async ({ id, flagged }) => {
      await queryClient.cancelQueries({ queryKey: ['catalog'] });
      const previous = queryClient.getQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] });
      queryClient.setQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                questions: page.questions.map((q) => (q.id === id ? { ...q, flagged } : q)),
              })),
            }
          : data,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      error('Could not update flag', err.message);
    },
  });
}

/**
 * Persist an AI-fixed text field (stem/options/answer) on a published question from the browse cards.
 * Optimistic like {@link useSetCatalogFlag}: the corrected field is patched into every cached browse
 * page immediately (the card already shows the AI value) and rolled back on failure. The card owns the
 * one-deep, per-field undo — this hook is the write; undo re-runs it with the pre-AI value.
 */
export function useCatalogFixText(): UseMutationResult<
  BankTextResult,
  Error,
  { id: string; patch: UpdateBankText },
  { previous: [readonly unknown[], CatalogInfiniteData | undefined][] }
> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: ({ id, patch }) => catalogApi.fixText(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['catalog'] });
      const previous = queryClient.getQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] });
      queryClient.setQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                // Merge only the fields the patch actually carries — spreading the whole patch would
                // widen each column to `| undefined` under exactOptionalPropertyTypes.
                questions: page.questions.map((q) =>
                  q.id === id
                    ? {
                        ...q,
                        ...(patch.questionText !== undefined ? { questionText: patch.questionText } : {}),
                        ...(patch.options !== undefined ? { options: patch.options } : {}),
                        ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
                      }
                    : q,
                ),
              })),
            }
          : data,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      error('Could not save the fix', err.message);
    },
  });
}

/**
 * Permanently delete a published question from the browse (removes the row from the bank db). Optimistic
 * like the flag/fix hooks: drops the row from every cached browse page and decrements that page's `total`
 * immediately, rolling back on failure. Deliberately does NOT invalidate — the deletion IS the intended
 * end state, so a refetch would only re-fetch the same shorter list (and a mid-flight refetch could flash
 * the row back). The operator's next real fetch reflects the smaller bank.
 */
export function useDeleteCatalogQuestion(): UseMutationResult<
  BankDeleteResult,
  Error,
  string,
  { previous: [readonly unknown[], CatalogInfiniteData | undefined][] }
> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id) => catalogApi.deleteQuestion(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['catalog'] });
      const previous = queryClient.getQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] });
      queryClient.setQueriesData<CatalogInfiniteData>({ queryKey: ['catalog'] }, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => {
                const kept = page.questions.filter((q) => q.id !== id);
                // Only the page that held the row changes — shrink its list and its running total so the
                // "Showing X of N" header stays truthful without a round-trip.
                return kept.length === page.questions.length
                  ? page
                  : { ...page, questions: kept, total: Math.max(0, page.total - 1) };
              }),
            }
          : data,
      );
      return { previous };
    },
    onError: (err, _id, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      error('Could not delete', err.message);
    },
    onSuccess: () => { success('Question deleted', 'Removed from the bank.'); },
  });
}
