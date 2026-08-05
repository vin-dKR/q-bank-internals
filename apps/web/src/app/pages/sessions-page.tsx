import { type JSX, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session, SessionStatus } from '@ingest/contracts';
import { SessionStatusSchema } from '@ingest/contracts';
import {
  useBulkDeleteSessions,
  useDeleteSession,
  useSessions,
} from '../../features/sessions/index.js';
import { PageHeader, StatusBadge } from '../../shared/ui/index.js';

type StatusFilter = SessionStatus | 'all';

/** Sessions index: a filterable card per upload run, opening its Phase-2 workspace. */
export function SessionsPage(): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const sessions = useSessions(status === 'all' ? undefined : status);
  const deleteSession = useDeleteSession();
  const bulkDelete = useBulkDeleteSessions();

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

  const removeMany = (ids: string[], prompt: string): void => {
    if (ids.length === 0 || !window.confirm(prompt)) return;
    bulkDelete.mutate(ids, { onSuccess: () => { setSelected(new Set()); } });
  };

  return (
    <section className="page">
      <PageHeader
        title="Sessions"
        subtitle="Every Phase-1 upload run. Open one to review its files and run extraction."
        actions={
          <>
            <label className="field--inline">
              <span className="field__label">Status</span>
              <select
                value={status}
                style={{ width: 'auto' }}
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
            <Link className="btn btn--primary" to="/">＋ New session</Link>
          </>
        }
      />

      {sessions.isPending ? (
        <p className="muted">Loading sessions…</p>
      ) : sessions.isError ? (
        <p className="error">Could not reach the API. Is it running on :4000?</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="muted">
            No sessions{status === 'all' ? '' : ` with status "${status}"`}. Head to{' '}
            <Link to="/">Cut &amp; upload</Link> — a session is created automatically as you start.
          </p>
        </div>
      ) : (
        <>
          <div className="bulk-bar">
            <label className="bulk-bar__select-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
            <span className="bulk-bar__count">
              {selectedIds.length > 0 ? `${String(selectedIds.length)} selected` : `${String(items.length)} sessions`}
            </span>
            <span className="bulk-bar__spacer" />
            <button
              type="button"
              className="btn btn--danger btn--xs"
              disabled={selectedIds.length === 0 || bulkDelete.isPending}
              onClick={() =>
                { removeMany(selectedIds, `Delete ${String(selectedIds.length)} selected session(s) and all their files?`); }
              }
            >
              🗑 Delete selected
            </button>
            <button
              type="button"
              className="btn btn--danger btn--xs"
              disabled={bulkDelete.isPending}
              onClick={() =>
                { removeMany(
                  items.map((s) => s.id),
                  `Delete all ${String(items.length)} session(s)${status === 'all' ? '' : ` with status "${status}"`} and all their files?`,
                ); }
              }
            >
              🗑 Delete all{status === 'all' ? '' : ' filtered'}
            </button>
          </div>

          <div className="session-grid">
            {items.map((session) => {
              const context = [session.exam, session.subject, session.module].filter(Boolean).join(' › ');
              const isSelected = selected.has(session.id);
              return (
                <div
                  key={session.id}
                  className={`session-card${isSelected ? ' session-card--selected' : ''}`}
                >
                  <Link to={`/sessions/${session.id}`} className="session-card__body">
                    <div className="session-card__head">
                      <strong>{session.label}</strong>
                      <StatusBadge status={session.status} />
                    </div>
                    <div className="muted">{context || 'No context yet'}</div>
                    <div className="session-card__meta">
                      <span>{session.extractedCount}/{session.documentCount} extracted</span>
                      {session.autoRun ? <span className="badge badge--info">auto-run</span> : null}
                    </div>
                  </Link>
                  <div className="session-card__actions">
                    <label className="session-card__select">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => { toggleOne(session.id); }}
                      />
                      Select
                    </label>
                    <button
                      type="button"
                      className="btn btn--ghost btn--xs session-card__delete"
                      onClick={() => {
                        if (window.confirm(`Delete session "${session.label}" and all its files?`)) {
                          deleteSession.mutate(session.id);
                        }
                      }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
