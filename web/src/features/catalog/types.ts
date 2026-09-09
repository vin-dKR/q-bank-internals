import type { CatalogSort } from '@ingest/contracts';

/** The active browse selection held in the page — the sidebar filters plus the search box. */
export type CatalogFilterState = {
  exam: string;
  subject: string;
  /**
   * Module is stamped onto the published row at publish, so it both narrows the cascading dropdown
   * options (module → chapter) AND filters the browse list.
   */
  module: string;
  chapter: string;
  section: string;
  questionType: string;
  /** '' = any, 'true' = flagged only, 'false' = not flagged. */
  flagged: '' | 'true' | 'false';
  /** '' = any, 'true' = PYQ only, 'false' = exclude PYQ. */
  pyq: '' | 'true' | 'false';
  /**
   * "Content" edge-case filters (image / passage / matrix presence). '' = off (no constraint),
   * 'true' = require the feature. Rendered as checkboxes, so they never carry 'false'. Each
   * AND-combines with the taxonomy filters and with the others.
   */
  hasImage: '' | 'true';
  hasQuestionImage: '' | 'true';
  hasOptionImage: '' | 'true';
  hasPassageImage: '' | 'true';
  hasPassage: '' | 'true';
  hasMatch: '' | 'true';
  q: string;
  /** List ordering. Part of the filter state so a change re-keys the query and refetches from page one. */
  sort: CatalogSort;
};

/** The empty starting selection — nothing filtered, no search, newest-first. */
export const EMPTY_FILTERS: CatalogFilterState = {
  exam: '',
  subject: '',
  module: '',
  chapter: '',
  section: '',
  questionType: '',
  flagged: '',
  pyq: '',
  hasImage: '',
  hasQuestionImage: '',
  hasOptionImage: '',
  hasPassageImage: '',
  hasPassage: '',
  hasMatch: '',
  q: '',
  sort: 'newest',
};

/** The subset the cascading filter-options request narrows against. */
export type CatalogSelection = Pick<CatalogFilterState, 'exam' | 'subject' | 'module' | 'chapter' | 'questionType'>;
