// Public surface of the catalog module (§4). Read-only filter/search/paginate over the published bank.
export { CatalogService } from './catalog.service.js';
export { createCatalogRouter } from './catalog.routes.js';
export type {
  CatalogStore,
  CatalogFilters,
  CatalogFilterSelection,
  CatalogFilterOptionSets,
  CatalogQuestionPage,
} from './catalog.repository.js';
