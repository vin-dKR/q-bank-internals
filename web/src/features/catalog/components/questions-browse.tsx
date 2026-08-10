import { type JSX, useMemo, useState } from 'react';
import type { CatalogFilterOptions } from '@ingest/contracts';
import { Card } from '../../../shared/ui/index.js';
import { useCatalogQuestions, useFilterOptions } from '../hooks/use-catalog.js';
import { type CatalogFilterState, type CatalogSelection, EMPTY_FILTERS } from '../types.js';
import { FilterSidebar } from './filter-sidebar.js';
import { SearchBar } from './search-bar.js';
import { QuestionBrowseList } from './question-browse-list.js';

const EMPTY_OPTIONS: CatalogFilterOptions = {
  exams: [],
  subjects: [],
  chapters: [],
  sections: [],
  questionTypes: [],
};

/**
 * Apply one field change with the cascade eduents uses: a broader pick clears the narrower ones it
 * scopes, so you can never hold a subject from a different exam. Search and flag toggles reset nothing.
 */
function applyPatch(prev: CatalogFilterState, patch: Partial<CatalogFilterState>): CatalogFilterState {
  const next = { ...prev, ...patch };
  if ('exam' in patch) { next.subject = ''; next.chapter = ''; next.section = ''; }
  if ('subject' in patch) { next.chapter = ''; next.section = ''; }
  if ('chapter' in patch) { next.section = ''; }
  return next;
}

/**
 * The read-only Questions browse: a left filter rail + a searchable, paginated list of published
 * questions. Filtering applies live (no "Apply" step); the dropdown option sets cascade with the
 * current exam/subject/chapter/type. No folders, no paper generation — view, filter, and search only.
 */
export function QuestionsBrowse(): JSX.Element {
  const [filters, setFilters] = useState<CatalogFilterState>(EMPTY_FILTERS);

  const selection: CatalogSelection = useMemo(
    () => ({
      exam: filters.exam,
      subject: filters.subject,
      chapter: filters.chapter,
      questionType: filters.questionType,
    }),
    [filters.exam, filters.subject, filters.chapter, filters.questionType],
  );

  const optionsQuery = useFilterOptions(selection);
  const listQuery = useCatalogQuestions(filters);

  const loaded = listQuery.data?.pages.flatMap((page) => page.questions).length ?? 0;

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-6 max-[900px]:grid-cols-1">
      <aside className="max-[900px]:static">
        <Card className="sticky top-4">
          <FilterSidebar
            filters={filters}
            options={optionsQuery.data ?? EMPTY_OPTIONS}
            disabled={optionsQuery.isPending}
            onChange={(patch) => { setFilters((prev) => applyPatch(prev, patch)); }}
            onClear={() => { setFilters(EMPTY_FILTERS); }}
          />
        </Card>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <SearchBar value={filters.q} onChange={(q) => { setFilters((prev) => ({ ...prev, q })); }} />
        {!listQuery.isPending && !listQuery.isError ? (
          <p className="m-0 text-xs text-ink-3">
            {loaded === 0
              ? 'No questions'
              : `Showing ${String(loaded)}${listQuery.hasNextPage ? '+' : ''} question${loaded === 1 ? '' : 's'}`}
          </p>
        ) : null}
        <QuestionBrowseList query={listQuery} />
      </div>
    </div>
  );
}
