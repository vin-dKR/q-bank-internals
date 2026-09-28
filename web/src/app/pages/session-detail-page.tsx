import { type JSX, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Document, DocumentStatus } from '@ingest/contracts';
import { DocumentStatusSchema } from '@ingest/contracts';
import {
  ExtractionProgress,
  useDeleteSession,
  useReextractDocument,
  useResetDocumentExtraction,
  useRunDocumentExtraction,
  useRunSessionExtraction,
  useSession,
  useUpdateSession,
} from '../../features/sessions/index.js';
import { DocumentUnitList, useDeleteDocument, useDocuments, useUpdateDocument } from '../../features/documents/index.js';
import { LatexIssueActions, usePublishDocument } from '../../features/questions/index.js';
import { Badge, IconTrash, IconWarning, LoadingState, PageHeader, Spinner, StatusBadge, useConfirm } from '../../shared/ui/index.js';

type StatusFilter = DocumentStatus | 'all';
const ACTIVE_STATUSES = new Set<DocumentStatus>(['queued', 'extracting']);
function canRun(doc: Document): boolean {
  return doc.kind === 'question' && (doc.status === 'uploaded' || doc.status === 'failed');
}
function isExtracted(doc: Document): boolean {
  return doc.status === 'extracted' || doc.status === 'needs_review' || doc.status === 'approved'
    || doc.status === 'completed' || doc.status === 'published';
}

/** Phase-2 workspace for one session: summary, settings, files with per-file actions, and delete. */
export function SessionDetailPage(): JSX.Element {
  const navigate = useNavigate();
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const update = useUpdateSession();
  const deleteSession = useDeleteSession();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const runSession = useRunSessionExtraction();
  const runDoc = useRunDocumentExtraction();
  const reextractDoc = useReextractDocument();
  const resetDoc = useResetDocumentExtraction();
  const publishDoc = usePublishDocument();
  const [confirm, confirmDialog] = useConfirm();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  // Document ids whose live progress bar is shown. Seeded from the shared documents list (any file that
  // is queued/extracting), so a run started here OR by another operator surfaces the same bar; each bar
  // prunes itself a moment after its run ends.
  const [shownDocIds, setShownDocIds] = useState<string[]>([]);
  const dismissBar = (id: string): void => {
    setShownDocIds((prev) => prev.filter((docId) => docId !== id));
  };

  const documents = useDocuments(
    status === 'all' ? { sessionId } : { sessionId, status: [status] },
    { idlePollMs: 5000 },
  );

  // Track every currently-active file so its bar appears — including runs another operator started.
  useEffect(() => {
    const activeIds = (documents.data?.items ?? [])
      .filter((doc) => ACTIVE_STATUSES.has(doc.status))
      .map((doc) => doc.id);
    setShownDocIds((prev) => {
      let next = prev;
      for (const id of activeIds) if (!next.includes(id)) next = [...next, id];
      return next;
    });
  }, [documents.data]);

  if (session.isPending) return <LoadingState label="Loading session…" />;
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
    void confirm({
      title: `Delete “${s.label}”?`,
      body: 'This removes the session and all its files and questions.',
      tone: 'danger',
      confirmLabel: 'Delete',
    }).then((ok) => {
      if (ok) deleteSession.mutate(s.id, { onSuccess: () => { void navigate('/sessions'); } });
    });
  };

  const deleteDoc = (doc: Document): void => {
    void confirm({
      title: `Delete “${doc.fileName}”?`,
      tone: 'danger',
      confirmLabel: 'Delete',
    }).then((ok) => { if (ok) deleteDocument.mutate(doc.id); });
  };

  const publish = (doc: Document): void => {
    void confirm({
      title: `Publish “${doc.fileName}” to the main bank?`,
      body: 'Its verified questions become live in the main question bank.',
      confirmLabel: 'Publish',
    }).then((ok) => { if (ok) publishDoc.mutate(doc.id); });
  };

  const toggleFlag = (doc: Document): void => {
    updateDocument.mutate({ id: doc.id, patch: { flagged: !doc.flagged } });
  };

  const stopExtraction = (doc: Document): void => {
    void confirm({
      title: `Stop extraction on “${doc.fileName}”?`,
      body: 'This stops a run that is stuck (or was started elsewhere) and returns the file to a re-runnable state.',
      tone: 'danger',
      confirmLabel: 'Stop',
    }).then((ok) => { if (ok) resetDoc.mutate(doc.id); });
  };

  const reextract = (doc: Document): void => {
    void confirm({
      title: `Re-extract “${doc.fileName}”?`,
      body: 'This reruns the file with the prompts currently saved in Prompt Studio. Its existing draft questions, Verify edits, image crops, and comprehension groups will be replaced. Published question-bank copies are not changed.',
      tone: 'danger',
      confirmLabel: 'Re-extract',
    }).then((ok) => {
      if (!ok) return;
      // Show feedback immediately even before the document polling observes its queued status.
      setShownDocIds((previous) => (previous.includes(doc.id) ? previous : [...previous, doc.id]));
      reextractDoc.mutate(doc.id, { onError: () => { dismissBar(doc.id); } });
    });
  };

  /** The per-document action buttons for the unit list — decided here from kind + status. */
  const renderActions = (doc: Document): JSX.Element => (
    <>
      {doc.kind === 'question' && doc.flagged ? <Badge tone="danger">flagged</Badge> : null}
      {isExtracted(doc) ? (
        <>
          {doc.kind === 'question' ? <LatexIssueActions documentId={doc.id} /> : null}
          <Link className="btn btn--xs" to={`/verify?documentId=${doc.id}`}>View</Link>
          <Link className="btn btn--xs" to={`/documents/${doc.id}/data`}>Data</Link>
          {doc.status !== 'published' ? (
            <button
              type="button"
              className="btn btn--xs"
              disabled={reextractDoc.isPending}
              onClick={() => { reextract(doc); }}
            >
              Re-extract
            </button>
          ) : null}
          {doc.status === 'published' ? (
            <span className="badge badge--success">published</span>
          ) : (
            <button
              type="button"
              className="btn btn--xs"
              disabled={publishDoc.isPending}
              onClick={() => { publish(doc); }}
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
      ) : ACTIVE_STATUSES.has(doc.status) ? (
        <button
          type="button"
          className="btn btn--xs btn--danger"
          disabled={resetDoc.isPending}
          onClick={() => { stopExtraction(doc); }}
        >
          Stop
        </button>
      ) : null}
      {doc.kind === 'question' ? (
        <button
          type="button"
          className={`btn btn--xs ${doc.flagged ? 'btn--danger' : 'btn--ghost'}`}
          aria-pressed={doc.flagged}
          aria-label={doc.flagged ? `Unflag ${doc.fileName}` : `Flag ${doc.fileName}`}
          disabled={updateDocument.isPending}
          onClick={() => { toggleFlag(doc); }}
        >
          <IconWarning /> {doc.flagged ? 'Flagged' : 'Flag'}
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn--ghost btn--icon-only btn--icon-only-sm btn--danger"
        aria-label={`Delete ${doc.fileName}`}
        onClick={() => { deleteDoc(doc); }}
      >
        <IconTrash />
      </button>
    </>
  );

  return (
    <section className="page">
      <PageHeader
        title={s.label}
        subtitle={`${String(s.documentCount)} document${s.documentCount === 1 ? '' : 's'} · created ${new Date(s.createdAt).toLocaleDateString()}`}
        actions={
          <>
            <Link className="btn" to="/">← Cut &amp; upload</Link>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!firstExtracted}
              onClick={() => { if (firstExtracted) void navigate(`/verify?documentId=${firstExtracted.id}&auto=1`); }}
            >
              Continue to verify →
            </button>
          </>
        }
      />

      <div className="card">
        <div className="row justify-between">
          {editing ? (
            <div className="row">
              <input
                type="text"
                value={label}
                autoFocus
                onChange={(e) => { setLabel(e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); }}
                className="min-w-0 flex-1 max-w-[340px]"
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
              <IconTrash /> Delete session
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
            className="btn"
            disabled={runSession.isPending || busy || pending === 0}
            onClick={() => { runSession.mutate(s.id); }}
          >
            {busy ? <><Spinner /> Extracting…</> : 'Run extraction on all pending'}
          </button>
        </div>

        {shownDocIds.length > 0 ? (
          <div className="flex flex-col gap-2">
            {shownDocIds.map((id) => (
              <ExtractionProgress
                key={id}
                documentId={id}
                fileName={items.find((doc) => doc.id === id)?.fileName}
                onDismiss={() => { dismissBar(id); }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="row justify-between">
          <h2>Files</h2>
          <label className="field--inline">
            <span className="field__label">Status</span>
            <select value={status} className="w-auto" onChange={(e) => { setStatus(e.target.value as StatusFilter); }}>
              <option value="all">All</option>
              {DocumentStatusSchema.options.map((option) => (
                <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
        </div>
        {documents.isPending ? (
          <LoadingState label="Loading files…" />
        ) : items.length === 0 ? (
          <p className="muted">No files match this filter.</p>
        ) : (
          <DocumentUnitList items={items} renderActions={renderActions} />
        )}
      </div>

      {confirmDialog}
    </section>
  );
}
