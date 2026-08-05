import { type JSX, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DocumentPicker } from '../../features/documents/index.js';
import { VerifyWorkspace, usePublishDocument } from '../../features/questions/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * Verify & publish: pick a document, crop its figures onto each question, review, then publish the
 * questions into the main bank. Accepts a `?documentId=` deep-link so the session workspace jumps here.
 */
export function PipelinePage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const [documentId, setDocumentId] = useState<string | null>(searchParams.get('documentId'));
  // `?auto=1` (set by the session's "Continue to verify") means: auto-crop figures on arrival. It only
  // applies to the document we deep-linked into — picking a different one is a plain manual session.
  const autoRun = searchParams.get('auto') === '1' && documentId === searchParams.get('documentId');
  const publish = usePublishDocument();

  const onPublish = (): void => {
    if (!documentId) return;
    if (!window.confirm('Publish these questions into the main bank?')) return;
    publish.mutate(documentId);
  };

  return (
    <section className="page">
      <PageHeader
        title="Verify & publish"
        subtitle="Crop figures onto each question, review, then publish into the main bank."
        actions={
          documentId ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={publish.isPending}
              onClick={onPublish}
            >
              {publish.isPending ? 'Publishing…' : 'Publish to bank →'}
            </button>
          ) : undefined
        }
      />

      <div className="card">
        <label className="field">
          <span className="field__label">Document</span>
          <DocumentPicker value={documentId} onChange={setDocumentId} />
        </label>
        {publish.isSuccess ? (
          <p className="note">✓ Published {publish.data.published} question(s) into the main bank.</p>
        ) : null}
        {publish.isError ? <p className="error">{publish.error.message}</p> : null}
      </div>

      {documentId ? <VerifyWorkspace documentId={documentId} autoRun={autoRun} /> : null}
    </section>
  );
}
