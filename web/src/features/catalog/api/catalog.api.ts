import type { CatalogFilterOptions, CatalogPage } from '@ingest/contracts';
import { CatalogFilterOptionsSchema, CatalogPageSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import type { CatalogFilterState, CatalogSelection } from '../types.js';

/** Serialise the active selection + cursor into the browse query string, omitting empty fields. */
function toListQuery(filters: CatalogFilterState, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.exam) params.set('exam', filters.exam);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.chapter) params.set('chapter', filters.chapter);
  if (filters.section) params.set('section', filters.section);
  if (filters.questionType) params.set('questionType', filters.questionType);
  if (filters.flagged) params.set('flagged', filters.flagged);
  const keyword = filters.q.trim();
  if (keyword) params.set('q', keyword);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/** The cascading selection → filter-options query string (only the fields that narrow the sets). */
function toOptionsQuery(selection: CatalogSelection): string {
  const params = new URLSearchParams();
  if (selection.exam) params.set('exam', selection.exam);
  if (selection.subject) params.set('subject', selection.subject);
  if (selection.chapter) params.set('chapter', selection.chapter);
  if (selection.questionType) params.set('questionType', selection.questionType);
  return params.toString();
}

/** The only place the catalog (browse) feature hits the network. */
export const catalogApi = {
  list: (filters: CatalogFilterState, cursor: string | null): Promise<CatalogPage> =>
    request(`/catalog/questions?${toListQuery(filters, cursor)}`, { schema: CatalogPageSchema }),

  filterOptions: (selection: CatalogSelection): Promise<CatalogFilterOptions> =>
    request(`/catalog/filter-options?${toOptionsQuery(selection)}`, {
      schema: CatalogFilterOptionsSchema,
    }),
};
