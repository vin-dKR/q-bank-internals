import { type JSX, useState } from 'react';
import { DocumentPicker } from '../../features/documents/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * Stage-3 entry screen: pick an ingested section PDF, then (next iteration) load its extracted
 * questions beside the source page for verification. For now it proves the document dropdown + API.
 */
export function PipelinePage(): JSX.Element {
  const [documentId, setDocumentId] = useState<string | null>(null);

  return (
    <section className="page">
      <PageHeader
        title="Verify & publish"
        subtitle="Select an extracted section PDF to review its questions before publishing to the bank."
      />

      <div className="card">
        <label className="field">
          <span className="field__label">Document</span>
          <DocumentPicker value={documentId} onChange={setDocumentId} />
        </label>

        {documentId ? (
          <p className="note">
            Selected <code>{documentId}</code>. The verification panel (questions ↔ source page) mounts
            here next.
          </p>
        ) : null}
      </div>
    </section>
  );
}
