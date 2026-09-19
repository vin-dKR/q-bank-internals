import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { ANOMALY_KINDS, type Anomaly, type AnomalyPage, type UpdateAnomaly } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import {
  Badge,
  Button,
  EmptyState,
  IconCheck,
  IconCopy,
  LoadingState,
  buttonClasses,
  useToast,
} from '../../../shared/ui/index.js';
import { SEVERITY_TONE, formatDateTime } from '../lib/anomaly-display.js';

type ReviewAction = (id: string, status: UpdateAnomaly['status']) => void;

/** The question's taxonomy and provenance as one muted line; absent parts are skipped. */
function QuestionMeta({ anomaly }: { anomaly: Anomaly }): JSX.Element {
  const parts = [
    anomaly.subject,
    anomaly.chapter,
    anomaly.questionNumber !== null ? `Q${String(anomaly.questionNumber)}` : null,
    anomaly.questionType,
    anomaly.fileName,
  ].filter((part): part is string => part !== null && part.trim() !== '');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
      <span>{parts.length > 0 ? parts.join(' · ') : 'No subject or chapter recorded'}</span>
      {anomaly.ingestQuestionId === null ? <Badge dot={false}>legacy row</Badge> : null}
    </div>
  );
}

function AnomalyCard({
  anomaly,
  onReview,
  pending,
}: {
  anomaly: Anomaly;
  onReview: ReviewAction;
  pending: boolean;
}): JSX.Element {
  const { success } = useToast();
  const copyId = (): void => {
    void navigator.clipboard.writeText(anomaly.questionId).then(() => { success('Question id copied', anomaly.questionId); });
  };

  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[anomaly.severity]}>{anomaly.severity}</Badge>
          <span className="text-sm font-semibold text-ink">{ANOMALY_KINDS[anomaly.kind].label}</span>
          {anomaly.field !== null ? (
            <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{anomaly.field}</code>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={copyId} title="Copy the bank question id">
            <IconCopy /> Copy id
          </Button>
          {anomaly.documentId !== null ? (
            <Link
              to={`/verify?documentId=${encodeURIComponent(anomaly.documentId)}&restore=1`}
              className={buttonClasses('default', 'xs')}
            >
              Open in Verify
            </Link>
          ) : null}
          {anomaly.status === 'open' ? (
            <Button size="xs" disabled={pending} onClick={() => { onReview(anomaly.id, 'ignored'); }}>
              <IconCheck /> Ignore
            </Button>
          ) : anomaly.status === 'ignored' ? (
            <Button size="xs" disabled={pending} onClick={() => { onReview(anomaly.id, 'open'); }}>
              Reopen
            </Button>
          ) : null}
        </div>
      </header>

      <p className="m-0 text-sm text-ink-2">{anomaly.detail}</p>

      {anomaly.preview.trim() !== '' ? (
        <div className="line-clamp-3 rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink">
          <RenderLatex text={anomaly.preview} />
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <QuestionMeta anomaly={anomaly} />
        <span className="text-xs text-ink-3">
          {anomaly.questionAddedAt !== null ? (
            <span className="font-medium text-ink-2">Added to bank {formatDateTime(anomaly.questionAddedAt)} · </span>
          ) : null}
          First seen {formatDateTime(anomaly.firstSeenAt)}
          {anomaly.resolvedAt !== null ? ` · resolved ${formatDateTime(anomaly.resolvedAt)}` : ''}
        </span>
      </footer>
    </article>
  );
}

/** The paginated anomaly cards for the current selection, with a "load more" at the end. */
export function AnomalyList({
  query,
  onReview,
  pendingId,
}: {
  query: UseInfiniteQueryResult<{ pages: AnomalyPage[] }>;
  onReview: ReviewAction;
  pendingId: string | null;
}): JSX.Element {
  if (query.isPending) return <LoadingState label="Loading anomalies…" />;
  if (query.isError) return <p className="error">Could not load anomalies: {query.error.message}</p>;

  const anomalies = query.data.pages.flatMap((page) => page.anomalies);
  const total = query.data.pages[0]?.total ?? 0;
  if (anomalies.length === 0) {
    return <EmptyState title="No anomalies match" body="Nothing in this tab matches the current filters." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-ink-3">
        Showing {anomalies.length.toLocaleString()} of {total.toLocaleString()}
      </p>
      {anomalies.map((anomaly) => (
        <AnomalyCard key={anomaly.id} anomaly={anomaly} onReview={onReview} pending={pendingId === anomaly.id} />
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
