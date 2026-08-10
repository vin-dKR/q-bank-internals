import type { CatalogQuestion } from '@ingest/contracts';

/** The taxonomy + keyword constraints for one browse query. Every field is optional (empty = no filter). */
export type CatalogFilters = {
  exam?: string;
  subject?: string;
  chapter?: string;
  section?: string;
  questionType?: string;
  flagged?: boolean;
  q?: string;
};

/** One page of browse results: the rows plus the id-cursor for the next page (null at the end). */
export type CatalogQuestionPage = {
  questions: CatalogQuestion[];
  nextCursor: string | null;
};

/** The current selection the filter-options aggregation cascades against. */
export type CatalogFilterSelection = {
  exam?: string;
  subject?: string;
  chapter?: string;
  questionType?: string;
};

/** The distinct values that populate each filter dropdown, already narrowed by the selection. */
export type CatalogFilterOptionSets = {
  exams: string[];
  subjects: string[];
  chapters: string[];
  sections: string[];
  questionTypes: string[];
};

/**
 * PORT (§3) for the READ-only browse of the main bank's `Question` collection: filter + keyword
 * search + cursor pagination, plus the distinct values that populate the cascading filter dropdowns.
 * The sibling of {@link BankQuestionStore} (which fixes images) — this one never writes. Implemented
 * with raw Mongo in `infrastructure/catalog`, null-object for the in-memory dev driver.
 */
export interface CatalogStore {
  /** Published questions matching `filters`, id-ordered, `limit` per page from `cursor` onward. */
  listQuestions(
    filters: CatalogFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CatalogQuestionPage>;
  /** Distinct exam/subject/chapter/section/type values, narrowed by the current `selection`. */
  filterOptions(selection: CatalogFilterSelection): Promise<CatalogFilterOptionSets>;
}
