import { type JSX, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BankQuestion } from '@ingest/contracts';
import { DocumentPicker, useDocument, useRestoreDocument } from '../../features/documents/index.js';
import { VerifyWorkspace, usePublishDocument } from '../../features/questions/index.js';
import { BankQuestionSearch } from '../../features/bank/index.js';
import { useReextractDocument } from '../../features/sessions/index.js';
import { Button, Card, PageHeader, Spinner, useConfirm } from '../../shared/ui/index.js';

/**
 * Verify & publish. Two ways in, both landing in the SAME workspace:
 *  - pick a unit (its question PDF), or
 *  - search a published question and open its source — the workspace reopens the exact document +
 *    page it was published from (restoring the soft-deleted source), with that question ringed.
 * Once a unit is chosen the page becomes a full-height workspace with only a slim bar on top
 * (picker + publish), so the PDF and question editor own the screen.
 */
export function PipelinePage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [documentId, setDocumentId] = useState<string | null>(searchParams.get('documentId'));
  // When a search hit or Questions-browse link opens the workspace, land on its page with its question
  // ringed; both are null for the plain unit-pick path (open at page 1, nothing pre-focused).
  const [initialPage, setInitialPage] = useState<number | null>(null);
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(() => searchParams.get('questionId'));
  const autoRun = searchParams.get('auto') === '1' && documentId === searchParams.get('documentId');
  const publish = usePublishDocument();
  const restore = useRestoreDocument();
  const document = useDocument(documentId);
  const reextract = useReextractDocument();
  const [confirm, confirmDialog] = useConfirm();
  const isPublished = document.data?.status === 'published';

  // Arriving from a published question's "Open in Verify" (?restore=1): un-hide its source document +
  // session if they were soft-deleted, so the direct question link can always reach its source. Fires
  // once per target document.
  const restoreMutate = restore.mutate;
  const restoredFor = useRef<string | null>(null);
  const restoreTarget = searchParams.get('restore') === '1' ? searchParams.get('documentId') : null;
  useEffect(() => {
    if (restoreTarget && restoredFor.current !== restoreTarget) {
      restoredFor.current = restoreTarget;
      restoreMutate(restoreTarget);
    }
  }, [restoreTarget, restoreMutate]);

  // Open a searched published question in the same workspace: restore its (possibly soft-deleted)
  // source, then land on the exact document/page it was published from with that question ringed.
  const openFromSearch = (question: BankQuestion): void => {
    const ref = question.ingestRef;
    if (!ref) return;
    if (restoredFor.current !== ref.documentId) {
      restoredFor.current = ref.documentId;
      restoreMutate(ref.documentId);
    }
    setInitialPage(ref.sourceRegion.page);
    setFocusQuestionId(ref.questionId);
    setDocumentId(ref.documentId);
  };

  // Switching units from the top bar starts a clean workspace (no carried-over search focus).
  const selectUnit = (id: string): void => {
    setInitialPage(null);
    setFocusQuestionId(null);
    setDocumentId(id);
  };

  const onPublish = (): void => {
    if (!documentId) return;
    void confirm({
      title: isPublished ? 'Update the question bank?' : 'Publish to the main bank?',
      body: isPublished
        ? 'Apply your saved edits to the existing bank questions. Unchanged questions are skipped.'
        : 'These verified questions become live in the main question bank.',
      confirmLabel: isPublished ? 'Update bank' : 'Publish',
    }).then((ok) => { if (ok && documentId) publish.mutate(documentId); });
  };

  const onReextract = (): void => {
    if (!documentId || !document.data) return;
    const sessionId = document.data.sessionId;
    void confirm({
      title: `Re-extract “${document.data.fileName}”?`,
      body: 'This uses the prompts currently saved in Prompt Studio and replaces this file’s draft questions, Verify edits, image crops, and comprehension groups. You will be taken to the session to follow progress.',
      tone: 'danger',
      confirmLabel: 'Re-extract',
    }).then((ok) => {
      if (!ok || !documentId) return;
      reextract.mutate(documentId, { onSuccess: () => { void navigate(`/sessions/${String(sessionId)}`); } });
    });
  };

  if (!documentId) {
    return (
      <section className="flex flex-col gap-6">
        <PageHeader
          title="Verify & publish"
          subtitle="Open a unit to review its questions, or find a published question to fix at its source."
        />
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-1">
              <h2 className="card__title">Units</h2>
              <p className="muted">Pick a unit to review and publish its questions.</p>
            </div>
            <DocumentPicker value={null} onChange={selectUnit} />
          </Card>
          <Card>
            <div className="flex flex-col gap-1">
              <h2 className="card__title">Fix a published question</h2>
              <p className="muted">
                Search the bank, then reopen the exact source page it was published from.
              </p>
            </div>
            <BankQuestionSearch onPick={openFromSearch} />
          </Card>
        </div>
        {confirmDialog}
      </section>
    );
  }

  // The unit picker + publish now live at the top of the workspace's right panel (beside the page),
  // so the PDF and question editor own the full viewport height instead of losing a top bar to them.
  const sessionBar = (hasUnsavedEdits: boolean, isSaving: boolean): JSX.Element => (
    <>
      <div className="min-w-0 flex-1">
        <DocumentPicker value={documentId} onChange={selectUnit} />
      </div>
      {document.data?.kind === 'question' && document.data.status !== 'published' ? (
        <Button
          variant="default"
          className="flex-none"
          disabled={reextract.isPending || document.data.status === 'queued' || document.data.status === 'extracting'}
          onClick={onReextract}
        >
          {reextract.isPending ? <><Spinner /> Re-extracting…</> : 'Re-extract'}
        </Button>
      ) : null}
      <Button variant="primary" className="flex-none" disabled={publish.isPending || !document.data || hasUnsavedEdits || isSaving}
        title={hasUnsavedEdits ? 'Save your edits with Update all first' : undefined} onClick={onPublish}>
        {publish.isPending
          ? <><Spinner /> {isPublished ? 'Updating bank…' : 'Publishing…'}</>
          : isPublished ? 'Update bank →' : 'Publish to bank →'}
      </Button>
    </>
  );

  return (
    <section className="workspace max-[1000px]:h-auto">
      <VerifyWorkspace
        documentId={documentId}
        autoRun={autoRun}
        sessionBar={sessionBar}
        {...(initialPage !== null ? { initialPage } : {})}
        {...(focusQuestionId !== null ? { focusQuestionId } : {})}
      />
      {confirmDialog}
    </section>
  );
}
