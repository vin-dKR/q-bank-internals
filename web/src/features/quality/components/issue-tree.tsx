import { type JSX, useEffect, useState } from 'react';
import {
  ANOMALY_GROUP_LABELS,
  ANOMALY_KINDS,
  type AnomalyGroup,
  type AnomalyKind,
} from '@ingest/contracts';
import { cn } from '../../../shared/lib/cn.js';
import { SEVERITY_TONE, groupCounts } from '../lib/anomaly-display.js';
import { Badge } from '../../../shared/ui/index.js';

const ROW = 'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors';

/** The count on the right of every row, so a row's size is readable at a glance. */
function Count({ value, active }: { value: number; active: boolean }): JSX.Element {
  return (
    <span className={cn('flex-none text-xs tabular-nums', active ? 'text-brand' : 'text-ink-3')}>
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The one navigation panel for the fix workspace: everything → a group → a single rule, as a tree that
 * expands in place. It replaces the tile grid plus separate rule list, so there is one place to say what
 * you are working on and the current position is always visible.
 */
export function IssueTree({
  counts,
  group,
  kind,
  onSelect,
}: {
  /** Per-rule counts for the CURRENT filters, so the tree says how much of each rule this view holds. */
  counts: readonly { kind: AnomalyKind; count: number }[];
  group: AnomalyGroup | '';
  kind: AnomalyKind | '';
  onSelect: (selection: { group: AnomalyGroup | ''; kind: AnomalyKind | '' }) => void;
}): JSX.Element {
  const groups = groupCounts(counts);
  const total = groups.reduce((sum, row) => sum + row.count, 0);
  const [open, setOpen] = useState<AnomalyGroup | ''>(group);

  // Following a link from the dashboard ("Fix these →") selects a group; the tree opens it to match.
  useEffect(() => { setOpen(group); }, [group]);

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Problem types">
      <button
        type="button"
        aria-current={group === ''}
        onClick={() => { onSelect({ group: '', kind: '' }); setOpen(''); }}
        className={cn(ROW, group === '' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink hover:bg-surface-2')}
      >
        <span className="flex-1 text-sm">Everything</span>
        <Count value={total} active={group === ''} />
      </button>

      {groups.map(({ group: name, count, kinds }) => {
        const expanded = open === name;
        const selectedGroup = group === name;
        return (
          <div key={name} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              disabled={count === 0}
              onClick={() => {
                setOpen(expanded ? '' : name);
                onSelect({ group: name, kind: '' });
              }}
              className={cn(
                ROW,
                'disabled:cursor-not-allowed disabled:opacity-50',
                selectedGroup && kind === '' ? 'bg-brand-soft font-semibold text-brand' : 'text-ink hover:bg-surface-2',
              )}
            >
              <span aria-hidden="true" className={cn('flex-none text-[10px] text-ink-3 transition-transform', expanded && 'rotate-90')}>
                ▶
              </span>
              <span className="flex-1 truncate text-sm">{ANOMALY_GROUP_LABELS[name]}</span>
              <Count value={count} active={selectedGroup} />
            </button>

            {expanded ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 border-l border-line pb-1 pl-3 p-0">
                {kinds.length === 0 ? (
                  <li className="px-2.5 py-1 text-xs text-ink-3">Nothing here</li>
                ) : (
                  kinds.map((rule) => (
                    <li key={rule.kind}>
                      <button
                        type="button"
                        aria-current={kind === rule.kind}
                        onClick={() => { onSelect({ group: name, kind: kind === rule.kind ? '' : rule.kind }); }}
                        className={cn(ROW, kind === rule.kind ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
                      >
                        <Badge tone={SEVERITY_TONE[ANOMALY_KINDS[rule.kind].severity]} dot={false} className="flex-none px-1.5">
                          {ANOMALY_KINDS[rule.kind].severity.slice(0, 1).toUpperCase()}
                        </Badge>
                        <span className="flex-1 truncate text-[13px]" title={ANOMALY_KINDS[rule.kind].label}>
                          {ANOMALY_KINDS[rule.kind].label}
                        </span>
                        <Count value={rule.count} active={kind === rule.kind} />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
