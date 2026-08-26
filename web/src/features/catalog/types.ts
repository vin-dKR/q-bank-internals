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
  q: string;
};

/** The empty starting selection — nothing filtered, no search. */
export const EMPTY_FILTERS: CatalogFilterState = {
  exam: '',
  subject: '',
  module: '',
  chapter: '',
  section: '',
  questionType: '',
  flagged: '',
  pyq: '',
  q: '',
};

/** The subset the cascading filter-options request narrows against. */
export type CatalogSelection = Pick<CatalogFilterState, 'exam' | 'subject' | 'module' | 'chapter' | 'questionType'>;
