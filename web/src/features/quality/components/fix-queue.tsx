import type { JSX } from 'react';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { ANOMALY_KINDS, type FixQueuePage } from '@ingest/contracts';
import { Badge, Button, EmptyState, LoadingState } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { SEVERITY_TONE } from '../lib/anomaly-display.js';

/** The stem shortened to a single line — enough to recognise the question in the queue. */
function line(preview: string): string {
  return preview.replace(/\\[()[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The left rail of the fix workspace: one row per affected question (never one per problem), worst
 * severity first badge, and the count of problems on it. Selecting a row loads it into the fix panel.
 */
export function FixQueue({
  query,
  selectedId,
  onSelect,
}: {
  query: UseInfiniteQueryResult<{ pages: FixQueuePage[] }>;
  selectedId: string | null;
  onSelect: (questionId: string) => void;
}): JSX.Element {
  if (query.isPending) return <LoadingState label="Loading queue…" />;
  if (query.isError) return <p className="error">Could not load the queue: {query.error.message}</p>;

  const items = query.data.pages.flatMap((page) => page.items);
  const total = query.data.pages[0]?.total ?? 0;
  if (items.length === 0) {
    return <EmptyState title="Nothing to fix" body="No question matches the current filters." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 px-1 text-xs text-ink-3">
        {items.length.toLocaleString()} of {total.toLocaleString()} question{total === 1 ? '' : 's'}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((item) => {
          const selected = item.questionId === selectedId;
          return (
            <li key={item.questionId}>
              <button
                type="button"
                aria-current={selected}
                onClick={() => { onSelect(item.questionId); }}
                className={cn(
                  'flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border bg-surface p-3 text-left transition-colors',
                  selected ? 'border-brand ring-2 ring-brand-soft' : 'border-line hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={SEVERITY_TONE[item.severity]}>{item.severity}</Badge>
                  <span className="text-xs font-medium text-ink-2">
                    {item.anomalyCount} problem{item.anomalyCount === 1 ? '' : 's'}
                  </span>
                </div>
                <span className="line-clamp-2 text-[13px] leading-snug text-ink">{line(item.preview) || '(no question text)'}</span>
                <span className="truncate text-xs text-ink-3">
                  {[item.subject, item.chapter, item.questionNumber !== null ? `Q${String(item.questionNumber)}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'No subject or chapter'}
                </span>
                <span className="truncate text-xs text-ink-3">
                  {item.kinds.map((kind) => ANOMALY_KINDS[kind].label).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage ? (
        <Button
          size="xs"
          className="self-center"
          disabled={query.isFetchingNextPage}
          onClick={() => { void query.fetchNextPage(); }}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
