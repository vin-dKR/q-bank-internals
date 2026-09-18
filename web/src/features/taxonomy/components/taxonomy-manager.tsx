import { type JSX, useState } from 'react';
import type { TaxonomyDimension } from '@ingest/contracts';
import { cn } from '../../../shared/lib/cn.js';
import { DIMENSION_META, DIMENSION_ORDER } from '../lib/dimensions.js';
import { DictionaryPanel } from './dictionary-panel.js';

/**
 * Masters → Question taxonomy. An underline tab bar over the seven dictionary collections the extractor
 * and publisher resolve against; each tab is a full CRUD surface (see {@link DictionaryPanel}). The bar
 * scrolls horizontally rather than wrapping, so the seven dimensions stay one clean row on any width.
 */
export function TaxonomyManager(): JSX.Element {
  const [active, setActive] = useState<TaxonomyDimension>('exam');

  return (
    <div>
      <div
        role="tablist"
        aria-label="Taxonomy dimension"
        className="-mb-px flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {DIMENSION_ORDER.map((dimension) => {
          const selected = active === dimension;
          return (
            <button
              key={dimension}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => { setActive(dimension); }}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
                selected
                  ? 'border-brand font-semibold text-brand'
                  : 'border-transparent font-medium text-ink-3 hover:text-ink',
              )}
            >
              {DIMENSION_META[dimension].label}
            </button>
          );
        })}
      </div>

      <DictionaryPanel dimension={active} meta={DIMENSION_META[active]} />
    </div>
  );
}
