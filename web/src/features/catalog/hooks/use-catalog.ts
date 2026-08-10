import {
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type { CatalogFilterOptions, CatalogPage } from '@ingest/contracts';
import { catalogApi } from '../api/catalog.api.js';
import type { CatalogFilterState, CatalogSelection } from '../types.js';

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
