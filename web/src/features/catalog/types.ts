/** The active browse selection held in the page — the sidebar filters plus the search box. */
export type CatalogFilterState = {
  exam: string;
  subject: string;
  chapter: string;
  section: string;
  questionType: string;
  /** '' = any, 'true' = flagged only, 'false' = not flagged. */
  flagged: '' | 'true' | 'false';
  q: string;
};

/** The empty starting selection — nothing filtered, no search. */
export const EMPTY_FILTERS: CatalogFilterState = {
  exam: '',
  subject: '',
  chapter: '',
  section: '',
  questionType: '',
  flagged: '',
  q: '',
};

/** The subset the cascading filter-options request narrows against. */
export type CatalogSelection = Pick<CatalogFilterState, 'exam' | 'subject' | 'chapter' | 'questionType'>;
