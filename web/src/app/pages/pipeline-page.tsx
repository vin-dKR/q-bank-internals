import { type JSX, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DocumentPicker, useRestoreDocument } from '../../features/documents/index.js';
import { VerifyWorkspace, usePublishDocument } from '../../features/questions/index.js';
import { Button, Card, PageHeader, Spinner, useConfirm } from '../../shared/ui/index.js';

/**
 * Verify & publish: pick a unit, crop its figures onto each question, review, then publish into the
 * main bank. Once a unit is chosen the page becomes a full-height workspace with only a slim bar on
 * top (picker + publish), so the PDF and question editor own the screen.
 */
export function PipelinePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const [documentId, setDocumentId] = useState<string | null>(searchParams.get('documentId'));
  const autoRun = searchParams.get('auto') === '1' && documentId === searchParams.get('documentId');
  const publish = usePublishDocument();
  const restore = useRestoreDocument();
  const [confirm, confirmDialog] = useConfirm();

  // Arriving from a published question's "Edit" (?restore=1): un-hide its source document + session
  // if they were soft-deleted, so editing "gets the session back". Fires once per target document.
  const restoreMutate = restore.mutate;
  const restoredFor = useRef<string | null>(null);
  const restoreTarget = searchParams.get('restore') === '1' ? searchParams.get('documentId') : null;
  useEffect(() => {
    if (restoreTarget && restoredFor.current !== restoreTarget) {
      restoredFor.current = restoreTarget;
      restoreMutate(restoreTarget);
    }
  }, [restoreTarget, restoreMutate]);

  const onPublish = (): void => {
    if (!documentId) return;
    void confirm({
      title: 'Publish to the main bank?',
      body: 'These verified questions become live in the main question bank.',
      confirmLabel: 'Publish',
    }).then((ok) => { if (ok && documentId) publish.mutate(documentId); });
  };

  if (!documentId) {
    return (
      <section className="flex flex-col gap-6">
        <PageHeader
          title="Verify & publish"
          subtitle="Pick a unit, crop figures onto each question, review, then publish into the main bank."
        />
        <Card>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Unit</span>
            <DocumentPicker value={documentId} onChange={setDocumentId} />
          </label>
        </Card>
        {confirmDialog}
      </section>
    );
  }

  // The unit picker + publish now live at the top of the workspace's right panel (beside the page),
  // so the PDF and question editor own the full viewport height instead of losing a top bar to them.
  const sessionBar = (
    <>
      <div className="min-w-0 flex-1">
        <DocumentPicker value={documentId} onChange={setDocumentId} />
      </div>
      <Button variant="primary" className="flex-none" disabled={publish.isPending} onClick={onPublish}>
        {publish.isPending ? <><Spinner /> Publishing…</> : 'Publish to bank →'}
      </Button>
    </>
  );

  return (
    <section className="workspace max-[1000px]:h-auto">
      <VerifyWorkspace documentId={documentId} autoRun={autoRun} sessionBar={sessionBar} />
      {confirmDialog}
    </section>
  );
}
