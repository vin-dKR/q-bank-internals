import { type JSX, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DocumentPicker } from '../../features/documents/index.js';
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
  const [confirm, confirmDialog] = useConfirm();

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

  return (
    <section className="flex h-[calc(100vh-64px)] min-h-0 flex-col gap-3 max-[1000px]:h-auto">
      <div className="flex flex-none flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 shadow-sm">
        <div className="min-w-0 max-w-md flex-1">
          <DocumentPicker value={documentId} onChange={setDocumentId} />
        </div>
        <Button variant="primary" disabled={publish.isPending} onClick={onPublish}>
          {publish.isPending ? <><Spinner /> Publishing…</> : 'Publish to bank →'}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <VerifyWorkspace documentId={documentId} autoRun={autoRun} />
      </div>
      {confirmDialog}
    </section>
  );
}
