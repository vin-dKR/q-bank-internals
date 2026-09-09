import type { JSX } from 'react';
import type { CatalogPage, CatalogQuestion, UpdateBankText } from '@ingest/contracts';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { Button, EmptyState, IconFileText, IconLayers, PassageView, Skeleton } from '../../../shared/ui/index.js';
import { catalogPassageToView } from '../lib/to-question-view.js';
import { QuestionCard } from './question-card.js';

/**
 * Group the flat browse list for rendering: consecutive published rows sharing a comprehension
 * `groupId` (BLA-125) collapse under ONE read-only passage header; everything else is a standalone
 * card. Rows arrive id-sorted, and a group's siblings were published with consecutive ids, so a single
 * walk keeps them contiguous.
 */
type BrowseItem =
  | { kind: 'single'; question: CatalogQuestion }
  | { kind: 'group'; groupId: string; questions: CatalogQuestion[] };

function groupBrowseItems(questions: CatalogQuestion[]): BrowseItem[] {
  const items: BrowseItem[] = [];
  for (const question of questions) {
    const groupId = question.groupId;
    if (groupId === null) {
      items.push({ kind: 'single', question });
      continue;
    }
    const last = items[items.length - 1];
    if (last && last.kind === 'group' && last.groupId === groupId) last.questions.push(question);
    else items.push({ kind: 'group', groupId, questions: [question] });
  }
  return items;
}

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

  const renderCard = (question: CatalogQuestion): JSX.Element => (
    <QuestionCard
      key={question.id}
      question={question}
      onToggleFlag={(flagged) => { onToggleFlag(question.id, flagged); }}
      onFixText={(patch) => { onFixText(question.id, patch); }}
      flagPending={flagPendingId === question.id}
      fixPending={fixPendingId === question.id}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {groupBrowseItems(questions).map((item) => {
        if (item.kind === 'single') return renderCard(item.question);
        // The shared passage (text + figure) is denormalized onto every sibling row, so build it from
        // the first member; a group whose passage was not yet extracted falls back to a plain header.
        const passage = item.questions[0] ? catalogPassageToView(item.questions[0]) : null;
        return (
          <div key={`group_${item.groupId}`} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4">
            {passage ? (
              <PassageView passage={passage} count={item.questions.length} />
            ) : (
              <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                <IconLayers /> Comprehension
                <span className="text-xs font-normal text-ink-3">
                  · {item.questions.length} question{item.questions.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {item.questions.map((question) => renderCard(question))}
            </div>
          </div>
        );
      })}

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
