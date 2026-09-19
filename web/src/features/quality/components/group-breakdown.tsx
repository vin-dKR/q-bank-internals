import type { JSX } from 'react';
import { ANOMALY_GROUP_LABELS, ANOMALY_KINDS, type AnomalyGroup, type QualitySummary } from '@ingest/contracts';
import { Button } from '../../../shared/ui/index.js';
import { countByGroup } from '../lib/anomaly-display.js';

const TOP_KINDS = 3;

/**
 * A card per anomaly group showing what is open and which rules fired most — the dashboard's read-only
 * breakdown. "Fix these" is the one action: it opens the fix workspace already narrowed to that group, so
 * the dashboard never silently changes what the fix side is showing.
 */
export function GroupBreakdown({
  summary,
  onFixGroup,
}: {
  summary: QualitySummary;
  onFixGroup: (group: AnomalyGroup) => void;
}): JSX.Element {
  const groups = countByGroup(summary.byKind, 'open');

  return (
    <div className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[560px]:grid-cols-1">
      {groups.map(({ group, count, kinds }) => (
        <div
          key={group}
          className={`flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-sm ${count === 0 ? 'opacity-60' : ''}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{ANOMALY_GROUP_LABELS[group]}</span>
            <span className="text-lg font-semibold tabular-nums text-ink">{count.toLocaleString()}</span>
          </div>
          {kinds.length === 0 ? (
            <span className="text-xs text-ink-3">Nothing open</span>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {kinds.slice(0, TOP_KINDS).map(({ kind, count: kindCount }) => (
                  <li key={kind} className="flex justify-between gap-2 text-xs text-ink-2">
                    <span className="truncate" title={ANOMALY_KINDS[kind].label}>{ANOMALY_KINDS[kind].label}</span>
                    <span className="tabular-nums">{kindCount.toLocaleString()}</span>
                  </li>
                ))}
                {kinds.length > TOP_KINDS ? (
                  <li className="text-xs text-ink-3">+{String(kinds.length - TOP_KINDS)} more rule(s)</li>
                ) : null}
              </ul>
              <Button size="xs" className="self-start" onClick={() => { onFixGroup(group); }}>
                Fix these →
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
