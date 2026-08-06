import { type JSX, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session, SessionStatus } from '@ingest/contracts';
import { SessionStatusSchema } from '@ingest/contracts';
import {
  useBulkDeleteSessions,
  useDeleteSession,
  useSessions,
} from '../../features/sessions/index.js';
import {
  Badge,
  Button,
  Card,
  IconPlus,
  IconTrash,
  LoadingState,
  PageHeader,
  StatusBadge,
  buttonClasses,
  useConfirm,
} from '../../shared/ui/index.js';

type StatusFilter = SessionStatus | 'all';

/** Sessions index: a filterable card per upload run, opening its Phase-2 workspace. */
export function SessionsPage(): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sessions = useSessions(status === 'all' ? undefined : status);
  const deleteSession = useDeleteSession();
  const bulkDelete = useBulkDeleteSessions();
  const [confirm, confirmDialog] = useConfirm();

  const items: Session[] = sessions.data?.items ?? [];
  // Selection only ever refers to sessions currently in view — the filter's onChange clears it.
  const selectedIds = items.filter((session) => selected.has(session.id)).map((s) => s.id);
  const allSelected = items.length > 0 && selectedIds.length === items.length;

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(items.map((s) => s.id)));
  };

  const removeMany = async (ids: string[], title: string): Promise<void> => {
    if (ids.length === 0) return;
    if (!(await confirm({ title, tone: 'danger', confirmLabel: 'Delete' }))) return;
    bulkDelete.mutate(ids, { onSuccess: () => { setSelected(new Set()); } });
  };

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Sessions"
        subtitle="Every Phase-1 upload run. Open one to review its files and run extraction."
        actions={
          <>
            <label className="flex flex-row items-center gap-2">
              <span className="text-[13px] font-medium text-ink-2">Status</span>
              <select
                value={status}
                className="w-auto"
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setSelected(new Set());
                }}
              >
                <option value="all">All</option>
                {SessionStatusSchema.options.map((option) => (
                  <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
            <Link className={buttonClasses('primary')} to="/"><IconPlus /> New session</Link>
          </>
        }
      />

      {sessions.isPending ? (
        <LoadingState label="Loading sessions…" />
      ) : sessions.isError ? (
        <p className="m-0 text-sm text-bad">Could not reach the API. Is it running on :4000?</p>
      ) : items.length === 0 ? (
        <Card>
          <p className="m-0 text-sm text-ink-2">
            No sessions{status === 'all' ? '' : ` with status "${status}"`}. Head to{' '}
            <Link className="text-brand hover:underline" to="/">Cut &amp; upload</Link> — a session is
            created automatically as you start.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
            <span className="text-[13px] text-ink-2">
              {selectedIds.length > 0 ? `${String(selectedIds.length)} selected` : `${String(items.length)} sessions`}
            </span>
            <span className="ml-auto" />
            <Button
              variant="danger"
              size="xs"
              disabled={selectedIds.length === 0 || bulkDelete.isPending}
              onClick={() =>
                { void removeMany(selectedIds, `Delete ${String(selectedIds.length)} selected session(s) and all their files?`); }
              }
            >
              <IconTrash /> Delete selected
            </Button>
            <Button
              variant="danger"
              size="xs"
              disabled={bulkDelete.isPending}
              onClick={() =>
                { void removeMany(
                  items.map((s) => s.id),
                  `Delete all ${String(items.length)} session(s)${status === 'all' ? '' : ` with status "${status}"`} and all their files?`,
                ); }
              }
            >
              <IconTrash /> Delete all{status === 'all' ? '' : ' filtered'}
            </Button>
          </div>

          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
            {items.map((session) => {
              const context = [session.exam, session.subject, session.module].filter(Boolean).join(' › ');
              const isSelected = selected.has(session.id);
              return (
                <div
                  key={session.id}
                  className={`flex flex-col gap-2.5 rounded-xl border bg-surface p-4 shadow-sm transition-all hover:shadow-md ${
                    isSelected ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-line-strong'
                  }`}
                >
                  <Link to={`/sessions/${session.id}`} className="flex flex-col gap-2 text-inherit no-underline">
                    <div className="flex items-center justify-between gap-2.5 text-[15px]">
                      <strong>{session.label}</strong>
                      <StatusBadge status={session.status} />
                    </div>
                    <div className="text-sm text-ink-2">{context || 'No context yet'}</div>
                    <div className="mt-0.5 flex items-center gap-2.5 text-[13px] text-ink-2">
                      <span>{session.extractedCount}/{session.documentCount} extracted</span>
                      {session.autoRun ? <Badge tone="info">auto-run</Badge> : null}
                    </div>
                  </Link>
                  <div className="flex items-center justify-between gap-2.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => { toggleOne(session.id); }}
                      />
                      Select
                    </label>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="self-start"
                      onClick={() => {
                        void confirm({
                          title: `Delete “${session.label}”?`,
                          body: 'This removes the session and all its files.',
                          tone: 'danger',
                          confirmLabel: 'Delete',
                        }).then((ok) => { if (ok) deleteSession.mutate(session.id); });
                      }}
                    >
                      <IconTrash /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {confirmDialog}
    </section>
  );
}
