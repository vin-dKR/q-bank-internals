import { type JSX, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionStatus } from '@ingest/contracts';
import { SessionStatusSchema } from '@ingest/contracts';
import { useDeleteSession, useSessions } from '../../features/sessions/index.js';
import { PageHeader, StatusBadge } from '../../shared/ui/index.js';

type StatusFilter = SessionStatus | 'all';

/** Sessions index: a filterable card per upload run, opening its Phase-2 workspace. */
export function SessionsPage(): JSX.Element {
  const [status, setStatus] = useState<StatusFilter>('all');
  const sessions = useSessions(status === 'all' ? undefined : status);
  const deleteSession = useDeleteSession();

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
                onChange={(e) => { setStatus(e.target.value as StatusFilter); }}
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
      ) : sessions.data.items.length === 0 ? (
        <div className="card">
          <p className="muted">
            No sessions{status === 'all' ? '' : ` with status "${status}"`}. Head to{' '}
            <Link to="/">Cut &amp; upload</Link> — a session is created automatically as you start.
          </p>
        </div>
      ) : (
        <div className="session-grid">
          {sessions.data.items.map((session) => {
            const context = [session.exam, session.subject, session.module].filter(Boolean).join(' › ');
            return (
              <div key={session.id} className="session-card">
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
            );
          })}
        </div>
      )}
    </section>
  );
}
