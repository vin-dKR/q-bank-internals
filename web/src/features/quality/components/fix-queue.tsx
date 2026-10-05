import type { JSX } from 'react';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { ANOMALY_KINDS, type FixQueuePage } from '@ingest/contracts';
import { Button, EmptyState, LoadingState } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';

/** A short plain-text stem helps identify a question without turning the list into a preview panel. */
function line(preview: string): string {
  return preview.replace(/\\[()[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/** One row per affected question, in the server's newest-question order. */
export function FixQueue({
  query,
  selectedId,
  disabled = false,
  onSelect,
}: {
  query: UseInfiniteQueryResult<{ pages: FixQueuePage[] }>;
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (questionId: string) => void;
}): JSX.Element {
  if (query.isPending) return <LoadingState label="Loading questions…" />;
  if (query.isError) return <p className="error">Could not load the questions: {query.error.message}</p>;

  const items = query.data.pages.flatMap((page) => page.items);
  const total = query.data.pages[0]?.total ?? 0;
  if (items.length === 0) {
    return <EmptyState title="No questions here" body="Try clearing a filter or choosing another issue type." />;
  }

  return (
    <nav aria-label="Question list">
      <p className="m-0 px-4 py-2 text-xs text-ink-3">
        Showing {items.length.toLocaleString()} of {total.toLocaleString()}
      </p>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {items.map((item) => {
          const selected = item.questionId === selectedId;
          const firstIssue = item.kinds[0];
          const meta = [item.subject, item.chapter, item.questionNumber !== null ? `Q${String(item.questionNumber)}` : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={item.questionId}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                disabled={disabled}
                onClick={() => { onSelect(item.questionId); }}
                className={cn(
                  'flex w-full cursor-pointer flex-col gap-1.5 border-l-[3px] px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand disabled:cursor-wait',
                  selected ? 'border-brand bg-surface-2' : 'border-transparent hover:bg-surface-2',
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug text-ink">
                  {line(item.preview) || '(No question text)'}
                </span>
                <span className="truncate text-xs text-ink-3">{meta || 'No subject or chapter'}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
                  <span>{firstIssue ? ANOMALY_KINDS[firstIssue].label : 'Needs review'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.anomalyCount} issue{item.anomalyCount === 1 ? '' : 's'}</span>
                  <span className="capitalize text-ink-3">{item.severity}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage ? (
        <div className="flex justify-center p-3">
          <Button
            size="xs"
            disabled={query.isFetchingNextPage}
            onClick={() => { void query.fetchNextPage(); }}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
