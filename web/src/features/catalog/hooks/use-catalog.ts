import {
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { BankFlagResult, CatalogFilterOptions, CatalogPage } from '@ingest/contracts';
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
