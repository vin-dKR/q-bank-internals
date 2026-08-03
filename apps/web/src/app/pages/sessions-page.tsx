import { type JSX, useState } from 'react';
import type { DocumentStatus } from '@ingest/contracts';
import { DocumentStatusSchema } from '@ingest/contracts';
import {
  useRunSessionExtraction,
  useSessions,
  useSetAutoRun,
} from '../../features/sessions/index.js';
import { useDocuments } from '../../features/documents/index.js';
import { PageHeader, StatusBadge } from '../../shared/ui/index.js';

type StatusFilter = DocumentStatus | 'all';

/** Statuses that mean work is still in flight — while any exist, the table polls for live progress. */
const ACTIVE_STATUSES = new Set<DocumentStatus>(['queued', 'extracting']);

/**
 * Phase-2 console: pick a session, see its summary, run extraction, and filter its files by status
 * so an operator knows exactly what is pending, extracting, extracted, or done — and what not to redo.
 */
export function SessionsPage(): JSX.Element {
  const sessions = useSessions();
  const setAutoRun = useSetAutoRun();
  const runExtraction = useRunSessionExtraction();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');

  const documents = useDocuments(
    sessionId ? (status === 'all' ? { sessionId } : { sessionId, status: [status] }) : {},
  );

  const selected = sessions.data?.items.find((session) => session.id === sessionId) ?? null;
  const busy = (documents.data?.items ?? []).some((doc) => ACTIVE_STATUSES.has(doc.status));
  const pending = selected ? selected.documentCount - selected.extractedCount : 0;

  return (
    <section className="page">
      <PageHeader
        title="Sessions"
        subtitle="Each session is one Phase-1 upload run. Extraction runs later, per file — track and filter it here."
      />

      <div className="card">
        <label className="field">
          <span className="field__label">Active session</span>
          {sessions.isPending ? (
            <p className="muted">Loading sessions…</p>
          ) : sessions.isError ? (
            <p className="error">Could not reach the API. Is it running on :4000?</p>
          ) : sessions.data.items.length === 0 ? (
            <p className="muted">No sessions yet. Create one on the Cut &amp; upload screen.</p>
          ) : (
            <select value={sessionId ?? ''} onChange={(event) => { setSessionId(event.target.value); }}>
              <option value="" disabled>
                Select a session…
              </option>
              {sessions.data.items.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label} — {session.exam} › {session.subject} › {session.module}
                </option>
              ))}
            </select>
          )}
        </label>

        {selected ? (
          <>
            <div className="kpi-row">
              <div className="kpi">
                <span className="kpi__label">Status</span>
                <span style={{ marginTop: 4 }}>
                  <StatusBadge status={selected.status} />
                </span>
              </div>
              <div className="kpi">
                <span className="kpi__label">Documents</span>
                <span className="kpi__value">{selected.documentCount}</span>
              </div>
              <div className="kpi">
                <span className="kpi__label">Extracted</span>
                <span className="kpi__value">{selected.extractedCount}</span>
              </div>
              <div className="kpi">
                <span className="kpi__label">Pending</span>
                <span className="kpi__value">{pending}</span>
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={runExtraction.isPending || busy}
                onClick={() => { runExtraction.mutate(selected.id); }}
              >
                {busy ? 'Extracting…' : 'Run extraction on pending'}
              </button>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={selected.autoRun}
                  disabled={setAutoRun.isPending}
                  onChange={(event) => {
                    setAutoRun.mutate({ id: selected.id, autoRun: event.target.checked });
                  }}
                />
                <span className="switch__track" />
                <span>Auto-run — extract each file as it is uploaded</span>
              </label>
            </div>

            {runExtraction.isSuccess ? (
              <p className="muted">Queued {runExtraction.data.enqueued} document(s) for extraction.</p>
            ) : null}
            {runExtraction.isError ? <p className="error">{runExtraction.error.message}</p> : null}
          </>
        ) : null}
      </div>

      {sessionId ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Documents</h2>
            <label className="field--inline">
              <span className="field__label">Status</span>
              <select
                value={status}
                style={{ width: 'auto' }}
                onChange={(event) => { setStatus(event.target.value as StatusFilter); }}
              >
                <option value="all">All</option>
                {DocumentStatusSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {option.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {documents.isPending ? (
            <p className="muted">Loading documents…</p>
          ) : documents.isError ? (
            <p className="error">Could not load documents.</p>
          ) : documents.data.items.length === 0 ? (
            <p className="muted">No documents match this filter.</p>
          ) : (
            <div className="table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Kind</th>
                    <th>Section</th>
                    <th>Status</th>
                    <th>Questions</th>
                    <th>Extracted</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.data.items.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.fileName}</td>
                      <td>{doc.kind}</td>
                      <td>{doc.sectionName ?? doc.path.section}</td>
                      <td>
                        <StatusBadge status={doc.status} />
                      </td>
                      <td>{doc.questionCount}</td>
                      <td>{doc.extractedAt ? new Date(doc.extractedAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
