import { type JSX, useState } from 'react';
import { DocumentPicker } from '../../features/documents/index.js';

/**
 * Stage-2 entry screen: pick an ingested section PDF, then (next iteration) load its extracted
 * questions beside the source page for verification. For now it proves the Drive dropdown + API.
 */
export function PipelinePage(): JSX.Element {
  const [documentId, setDocumentId] = useState<string | null>(null);

  return (
    <section className="stack">
      <h1>Verify &amp; publish</h1>
      <p className="muted">Select a section PDF to load the questions extracted from it.</p>

      <DocumentPicker value={documentId} onChange={setDocumentId} />

      {documentId ? (
        <p className="note">
          Selected <code>{documentId}</code>. The verification panel (questions ↔ source page) mounts
          here next.
        </p>
      ) : null}
    </section>
  );
}
