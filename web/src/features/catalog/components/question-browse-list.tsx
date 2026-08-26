import type { JSX } from 'react';
import type { CatalogPage, UpdateBankText } from '@ingest/contracts';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { Button, EmptyState, IconFileText, Skeleton } from '../../../shared/ui/index.js';
import { QuestionCard } from './question-card.js';

/** Skeleton stand-ins matching the card shape, shown while the first page loads. */
function LoadingSkeletons(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * The results column of the Questions browse: renders the paginated cards and owns the four states —
 * loading (skeletons), error (inline note), empty (designed `EmptyState`), and loaded (+ "Load more").
 */
export function QuestionBrowseList({
  query,
  onToggleFlag,
  onFixText,
  flagPendingId,
  fixPendingId,
}: {
  query: UseInfiniteQueryResult<{ pages: CatalogPage[] }>;
  /** Toggle one question's flag by its bank id. */
  onToggleFlag: (id: string, flagged: boolean) => void;
  /** Persist an AI-fixed text field on one question by its bank id. */
  onFixText: (id: string, patch: UpdateBankText) => void;
  /** The id whose flag write is currently in flight (disables just that card's button). */
  flagPendingId: string | null;
  /** The id whose text-fix write is currently in flight (disables just that card's AI buttons). */
  fixPendingId: string | null;
}): JSX.Element {
  if (query.isPending) return <LoadingSkeletons />;

  if (query.isError) {
    return (
      <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
        Couldn’t load questions: {query.error.message}
      </div>
    );
  }

  const questions = query.data.pages.flatMap((page) => page.questions);

  if (questions.length === 0) {
    return (
      <EmptyState
        icon={<IconFileText />}
        title="No questions match"
        body="Try clearing a filter or searching for a different keyword."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          onToggleFlag={(flagged) => { onToggleFlag(question.id, flagged); }}
          onFixText={(patch) => { onFixText(question.id, patch); }}
          flagPending={flagPendingId === question.id}
          fixPending={fixPendingId === question.id}
        />
      ))}

      {query.hasNextPage ? (
        <div className="flex justify-center pt-1">
          <Button
            variant="default"
            onClick={() => { void query.fetchNextPage(); }}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
