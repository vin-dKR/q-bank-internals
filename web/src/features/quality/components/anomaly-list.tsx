import { type JSX, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { ANOMALY_KINDS, type Anomaly, type AnomalyPage, type UpdateAnomaly } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { Button, EmptyState, IconCopy, LoadingState, buttonClasses, useToast } from '../../../shared/ui/index.js';
import { formatDateTime } from '../lib/anomaly-display.js';

type ReviewAction = (id: string, status: UpdateAnomaly['status']) => void;

/** The question context needed to recognise a result without opening it. */
function QuestionMeta({ anomaly }: { anomaly: Anomaly }): JSX.Element {
  const parts = [
    anomaly.subject,
    anomaly.chapter,
    anomaly.questionNumber !== null ? `Q${String(anomaly.questionNumber)}` : null,
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return <span>{parts.length > 0 ? parts.join(' · ') : 'No subject or chapter recorded'}</span>;
}

function AnomalyCard({
  anomaly,
  onReview,
  onFixQuestion,
  pending,
}: {
  anomaly: Anomaly;
  onReview: ReviewAction;
  onFixQuestion?: ((questionId: string) => void) | undefined;
  pending: boolean;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const { success } = useToast();
  const copyId = (): void => {
    void navigator.clipboard.writeText(anomaly.questionId).then(() => { success('Question ID copied', anomaly.questionId); });
  };

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-2">
            {anomaly.severity}
          </span>
          <span className="text-sm font-semibold text-ink">{ANOMALY_KINDS[anomaly.kind].label}</span>
        </div>
        <div className="flex flex-none items-center gap-1">
          {anomaly.status === 'open' && onFixQuestion ? (
            <Button size="xs" onClick={() => { onFixQuestion(anomaly.questionId); }}>Fix question</Button>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => { setExpanded((open) => !open); }}
          >
            {expanded ? 'Less detail' : 'Details'}
          </Button>
          {anomaly.status === 'open' ? (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => { onReview(anomaly.id, 'ignored'); }}>
              Ignore
            </Button>
          ) : anomaly.status === 'ignored' ? (
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => { onReview(anomaly.id, 'open'); }}>
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      <div className="line-clamp-2 text-sm leading-relaxed text-ink-2">
        {anomaly.preview.trim() !== '' ? <RenderLatex text={anomaly.preview} /> : anomaly.detail}
      </div>
      <div className="text-xs text-ink-3">
        <QuestionMeta anomaly={anomaly} />
        {anomaly.fileName ? <span> · {anomaly.fileName}</span> : null}
      </div>

      <div id={detailsId} className={expanded ? 'border-t border-line pt-3' : 'hidden'}>
        <p className="m-0 text-sm text-ink-2">{anomaly.detail}</p>
        <dl className="my-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {anomaly.field !== null ? (
            <>
              <dt className="text-ink-3">Field</dt>
              <dd className="m-0 font-mono text-ink-2">{anomaly.field}</dd>
            </>
          ) : null}
          {anomaly.questionType ? (
            <>
              <dt className="text-ink-3">Question type</dt>
              <dd className="m-0 text-ink-2">{anomaly.questionType}</dd>
            </>
          ) : null}
          {anomaly.questionAddedAt !== null ? (
            <>
              <dt className="text-ink-3">Added to bank</dt>
              <dd className="m-0 text-ink-2">{formatDateTime(anomaly.questionAddedAt)}</dd>
            </>
          ) : null}
          <dt className="text-ink-3">First seen</dt>
          <dd className="m-0 text-ink-2">{formatDateTime(anomaly.firstSeenAt)}</dd>
          {anomaly.resolvedAt !== null ? (
            <>
              <dt className="text-ink-3">Resolved</dt>
              <dd className="m-0 text-ink-2">{formatDateTime(anomaly.resolvedAt)}</dd>
            </>
          ) : null}
          {anomaly.ingestQuestionId === null ? (
            <>
              <dt className="text-ink-3">Source</dt>
              <dd className="m-0 text-ink-2">Legacy bank question</dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="xs" onClick={copyId} title="Copy the bank question ID">
            <IconCopy /> Copy ID
          </Button>
          {anomaly.documentId !== null ? (
            <Link
              to={`/verify?documentId=${encodeURIComponent(anomaly.documentId)}&restore=1`}
              className={buttonClasses('default', 'xs')}
            >
              Open in Verify
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** The paginated issue register for the current selection. */
export function AnomalyList({
  query,
  onReview,
  onFixQuestion,
  pendingId,
}: {
  query: UseInfiniteQueryResult<{ pages: AnomalyPage[] }>;
  onReview: ReviewAction;
  onFixQuestion?: ((questionId: string) => void) | undefined;
  pendingId: string | null;
}): JSX.Element {
  if (query.isPending) return <LoadingState label="Loading issues…" />;
  if (query.isError) return <p className="error">Could not load issues: {query.error.message}</p>;

  const anomalies = query.data.pages.flatMap((page) => page.anomalies);
  const total = query.data.pages[0]?.total ?? 0;
  if (anomalies.length === 0) {
    return <EmptyState title="No matching issues" body="Try clearing a filter or choosing another status." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs text-ink-3">Showing {anomalies.length.toLocaleString()} of {total.toLocaleString()} issues</p>
      {anomalies.map((anomaly) => (
        <AnomalyCard key={anomaly.id} anomaly={anomaly} onReview={onReview} onFixQuestion={onFixQuestion} pending={pendingId === anomaly.id} />
      ))}
      {query.hasNextPage ? (
        <Button
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
