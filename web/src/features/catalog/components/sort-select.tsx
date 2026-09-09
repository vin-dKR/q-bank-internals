import type { JSX } from 'react';
import type { CatalogSort } from '@ingest/contracts';
import { Combobox } from '../../../shared/ui/index.js';

/** The human labels for each sort key — the order here is the order the dropdown lists them. */
const SORT_LABELS: Record<CatalogSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
};

const SORT_KEYS = Object.keys(SORT_LABELS) as CatalogSort[];

/**
 * The browse ordering control — a small labelled {@link Combobox} over the fixed sort keys. Both keys
 * order by publish time (newest / oldest); the parent holds the choice in the filter state so picking
 * one refetches from page one.
 */
export function SortSelect({
  value,
  onChange,
}: {
  value: CatalogSort;
  onChange: (sort: CatalogSort) => void;
}): JSX.Element {
  const handle = (label: string): void => {
    const picked = SORT_KEYS.find((key) => SORT_LABELS[key] === label);
    if (picked) onChange(picked);
  };

  return (
    <label className="flex items-center gap-2 text-xs text-ink-3">
      Sort
      <div className="w-36">
        <Combobox
          value={SORT_LABELS[value]}
          onChange={handle}
          options={SORT_KEYS.map((key) => SORT_LABELS[key])}
          allowCustom={false}
        />
      </div>
    </label>
  );
}
