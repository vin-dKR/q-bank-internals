import type { JSX } from 'react';
import type { Document } from '@ingest/contracts';
import { useDocuments } from '../hooks/use-documents.js';

type DocumentPickerProps = {
  value: string | null;
  onChange: (documentId: string) => void;
};

/**
 * The Drive-backed dropdown from pipeline stage 2: lists ingested section PDFs by their
 * module / chapter / section path. Selecting one is what drives the verification view.
 */
export function DocumentPicker({ value, onChange }: DocumentPickerProps): JSX.Element {
  const { data, isPending, isError } = useDocuments();

  if (isPending) return <p className="muted">Loading documents…</p>;
  if (isError) return <p className="error">Could not reach the API. Is it running on :4000?</p>;

  if (data.items.length === 0) {
    return <p className="muted">No documents yet. Register a Drive PDF to see it here.</p>;
  }

  return (
    <select
      value={value ?? ''}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      <option value="" disabled>
        Select a section PDF…
      </option>
      {data.items.map((doc: Document) => (
        <option key={doc.id} value={doc.id}>
          {doc.path.module} › {doc.path.chapter} › {doc.path.section} — {doc.fileName} [{doc.status}]
        </option>
      ))}
    </select>
  );
}
