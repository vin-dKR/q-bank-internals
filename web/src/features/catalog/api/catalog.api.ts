import type { BankFlagResult, BankTextResult, CatalogFilterOptions, CatalogPage, UpdateBankText } from '@ingest/contracts';
import { BankFlagResultSchema, BankTextResultSchema, CatalogFilterOptionsSchema, CatalogPageSchema } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';
import type { CatalogFilterState, CatalogSelection } from '../types.js';

/** Serialise the active selection + cursor into the browse query string, omitting empty fields. */
function toListQuery(filters: CatalogFilterState, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.exam) params.set('exam', filters.exam);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.module) params.set('module', filters.module);
  if (filters.chapter) params.set('chapter', filters.chapter);
  if (filters.section) params.set('section', filters.section);
  if (filters.questionType) params.set('questionType', filters.questionType);
  if (filters.flagged) params.set('flagged', filters.flagged);
  if (filters.pyq) params.set('pyq', filters.pyq);
  if (filters.hasImage) params.set('hasImage', filters.hasImage);
  if (filters.hasQuestionImage) params.set('hasQuestionImage', filters.hasQuestionImage);
  if (filters.hasOptionImage) params.set('hasOptionImage', filters.hasOptionImage);
  if (filters.hasPassageImage) params.set('hasPassageImage', filters.hasPassageImage);
  if (filters.hasPassage) params.set('hasPassage', filters.hasPassage);
  if (filters.hasMatch) params.set('hasMatch', filters.hasMatch);
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
  if (selection.module) params.set('module', selection.module);
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

  /**
   * Set/clear the flag on a published question, so it stays findable via the Flagged filter. `id` is
   * the bank Mongo id the browse card carries; this hits the bank module's flag endpoint (the write
   * surface for published questions — the catalog read path itself never writes).
   */
  setFlag: (id: string, flagged: boolean): Promise<BankFlagResult> =>
    request(`/bank/questions/${id}/flag`, {
      method: 'PATCH',
      body: { flagged },
      schema: BankFlagResultSchema,
    }),

  /**
   * Persist an AI-fixed text field (stem/options/answer) on a published question, keyed by the bank
   * Mongo `id` the browse card carries. The same bank write surface the flag toggle uses; the
   * corrected value is produced client-side by {@link refineLatex} before it reaches here.
   */
  fixText: (id: string, patch: UpdateBankText): Promise<BankTextResult> =>
    request(`/bank/questions/${id}/text`, {
      method: 'PATCH',
      body: patch,
      schema: BankTextResultSchema,
    }),
};
