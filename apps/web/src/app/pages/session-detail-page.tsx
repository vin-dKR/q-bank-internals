import { type JSX, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Document, DocumentStatus } from '@ingest/contracts';
import { DocumentStatusSchema } from '@ingest/contracts';
import {
  useDeleteSession,
  useRunDocumentExtraction,
  useRunSessionExtraction,
  useSession,
  useUpdateSession,
} from '../../features/sessions/index.js';
import { useDeleteDocument, useDocuments } from '../../features/documents/index.js';
import { ConfigsModal, usePublishDocument } from '../../features/questions/index.js';
import { PageHeader, StatusBadge } from '../../shared/ui/index.js';

type StatusFilter = DocumentStatus | 'all';
const ACTIVE_STATUSES = new Set<DocumentStatus>(['queued', 'extracting']);
function canRun(doc: Document): boolean {
  return doc.kind === 'question' && (doc.status === 'uploaded' || doc.status === 'failed');
}
function isExtracted(doc: Document): boolean {
  return doc.status === 'extracted' || doc.status === 'completed' || doc.status === 'published';
}

/** Phase-2 workspace for one session: summary, settings, files with per-file actions, and delete. */
export function SessionDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const update = useUpdateSession();
  const deleteSession = useDeleteSession();
  const deleteDocument = useDeleteDocument();
  const runSession = useRunSessionExtraction();
  const runDoc = useRunDocumentExtraction();
  const publishDoc = usePublishDocument();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [configsFor, setConfigsFor] = useState<string | null>(null);

  const documents = useDocuments(
    status === 'all' ? { sessionId } : { sessionId, status: [status] },
  );

  if (session.isPending) return <p className="muted">Loading session…</p>;
  if (session.isError) return <p className="error">Could not load this session.</p>;

  const s = session.data;
  const items = documents.data?.items ?? [];
  const busy = items.some((doc) => ACTIVE_STATUSES.has(doc.status));
  const pending = s.documentCount - s.extractedCount;
  const firstExtracted = items.find(isExtracted);

  const saveLabel = (): void => {
    if (label.trim() && label.trim() !== s.label) update.mutate({ id: s.id, patch: { label: label.trim() } });
    setEditing(false);
  };
  const onDeleteSession = (): void => {
    if (!window.confirm(`Delete session "${s.label}" and all its files + questions?`)) return;
    deleteSession.mutate(s.id, { onSuccess: () => { void navigate('/sessions'); } });
  };

  return (
    <section className="page">
      <PageHeader
        title={s.label}
        subtitle={[s.exam, s.subject, s.module].filter(Boolean).join(' › ') || 'No context yet'}
        actions={
          <>
            <Link className="btn" to="/">← Cut &amp; upload</Link>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!firstExtracted}
              onClick={() => { if (firstExtracted) void navigate(`/verify?documentId=${firstExtracted.id}`); }}
            >
              Continue to verify →
            </button>
          </>
        }
      />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          {editing ? (
            <div className="row">
              <input
                type="text"
                value={label}
                autoFocus
                onChange={(e) => { setLabel(e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); }}
                style={{ maxWidth: 340 }}
              />
              <button type="button" className="btn btn--primary btn--xs" onClick={saveLabel}>Save</button>
              <button type="button" className="btn btn--xs" onClick={() => { setEditing(false); }}>Cancel</button>
            </div>
          ) : (
            <div className="row">
              <StatusBadge status={s.status} />
              <button type="button" className="btn btn--ghost btn--xs" onClick={() => { setLabel(s.label); setEditing(true); }}>
                Rename
              </button>
            </div>
          )}
          <div className="row">
            <label className="switch">
              <input
                type="checkbox"
                checked={s.autoRun}
                disabled={update.isPending}
                onChange={(e) => { update.mutate({ id: s.id, patch: { autoRun: e.target.checked } }); }}
              />
              <span className="switch__track" />
              <span>Auto-run</span>
            </label>
            <button type="button" className="btn btn--ghost btn--xs" onClick={onDeleteSession}>
              🗑 Delete session
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <div className="kpi"><span className="kpi__label">Documents</span><span className="kpi__value">{s.documentCount}</span></div>
          <div className="kpi"><span className="kpi__label">Extracted</span><span className="kpi__value">{s.extractedCount}</span></div>
          <div className="kpi"><span className="kpi__label">Pending</span><span className="kpi__value">{pending}</span></div>
        </div>

        <div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={runSession.isPending || busy || pending === 0}
            onClick={() => { runSession.mutate(s.id); }}
          >
            {busy ? 'Extracting…' : 'Run extraction on all pending'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Files</h2>
          <label className="field--inline">
            <span className="field__label">Status</span>
            <select value={status} style={{ width: 'auto' }} onChange={(e) => { setStatus(e.target.value as StatusFilter); }}>
              <option value="all">All</option>
              {DocumentStatusSchema.options.map((option) => (
                <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
        </div>
        {documents.isPending ? (
          <p className="muted">Loading files…</p>
        ) : items.length === 0 ? (
          <p className="muted">No files match this filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="doc-table">
              <thead>
                <tr><th>File</th><th>Kind</th><th>Section</th><th>Status</th><th>Questions</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.fileName}</td>
                    <td>{doc.kind}</td>
                    <td>{doc.sectionName ?? doc.path.section}</td>
                    <td><StatusBadge status={doc.status} /></td>
                    <td>{doc.questionCount}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {isExtracted(doc) ? (
                          <>
                            <Link className="btn btn--xs" to={`/verify?documentId=${doc.id}`}>View</Link>
                            <button type="button" className="btn btn--xs" onClick={() => { setConfigsFor(doc.id); }}>
                              Configs
                            </button>
                            {doc.status === 'published' ? (
                              <span className="badge badge--success">published</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--primary btn--xs"
                                disabled={publishDoc.isPending}
                                onClick={() => {
                                  if (window.confirm(`Publish "${doc.fileName}" to the main bank?`)) {
                                    publishDoc.mutate(doc.id);
                                  }
                                }}
                              >
                                Publish
                              </button>
                            )}
                          </>
                        ) : canRun(doc) ? (
                          <button
                            type="button"
                            className="btn btn--xs"
                            disabled={runDoc.isPending}
                            onClick={() => { runDoc.mutate(doc.id); }}
                          >
                            Run
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--ghost btn--xs"
                          onClick={() => {
                            if (window.confirm(`Delete "${doc.fileName}"?`)) deleteDocument.mutate(doc.id);
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {configsFor ? <ConfigsModal documentId={configsFor} onClose={() => { setConfigsFor(null); }} /> : null}
    </section>
  );
}
