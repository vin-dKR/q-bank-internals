import type { JSX } from 'react';
import { ANOMALY_GROUP_LABELS, ANOMALY_KINDS, type AnomalyGroup, type QualitySummary } from '@ingest/contracts';
import { countByGroup } from '../lib/anomaly-display.js';

/** One ranked list turns the scan breakdown into the next action. */
export function GroupBreakdown({
  summary,
  onFixGroup,
}: {
  summary: QualitySummary;
  onFixGroup: (group: AnomalyGroup) => void;
}): JSX.Element {
  const groups = countByGroup(summary.byKind, 'open')
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  if (groups.length === 0) {
    return <p className="m-0 rounded-lg border border-line bg-surface-2 px-4 py-5 text-sm text-ink-2">No open issues were found in the last scan.</p>;
  }

  return (
    <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-lg border border-line p-0">
      {groups.map(({ group, count, kinds }) => (
        <li key={group}>
          <button
            type="button"
            onClick={() => { onFixGroup(group); }}
            className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 max-[640px]:flex-wrap"
            aria-label={`Fix questions with ${ANOMALY_GROUP_LABELS[group]} issues`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{ANOMALY_GROUP_LABELS[group]}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-2">
                {kinds.slice(0, 2).map((row) => ANOMALY_KINDS[row.kind].label).join(' · ')}
                {kinds.length > 2 ? ` · ${String(kinds.length - 2)} more types` : ''}
              </span>
            </span>
            <span className="w-24 flex-none text-right text-sm font-semibold tabular-nums text-ink">
              {count.toLocaleString()} <span className="text-xs font-normal text-ink-3">issues</span>
            </span>
            <span className="w-16 flex-none text-right text-xs font-medium text-ink-2">Review →</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
