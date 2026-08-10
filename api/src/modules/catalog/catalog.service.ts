import type { CatalogFilterOptions, CatalogPage } from '@ingest/contracts';
import type { CatalogFilters, CatalogFilterSelection, CatalogStore } from './catalog.repository.js';

/**
 * Read side of the main bank for the Questions browse page: filter/search/paginate published
 * questions and serve the cascading filter option sets. The Mongo shaping lives in infrastructure;
 * this service is the thin seam the controller talks to so a route never sees the port (§2).
 */
export class CatalogService {
  constructor(private readonly store: CatalogStore) {}

  listQuestions(filters: CatalogFilters, cursor: string | null, limit: number): Promise<CatalogPage> {
    return this.store.listQuestions(filters, cursor, limit);
  }

  filterOptions(selection: CatalogFilterSelection): Promise<CatalogFilterOptions> {
    return this.store.filterOptions(selection);
  }
}
