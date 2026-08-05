import type { JSX } from 'react';
import type { Document } from '@ingest/contracts';
import { LoadingState } from '../../../shared/ui/index.js';
import { useDocuments } from '../hooks/use-documents.js';
import { type DocumentUnit, groupByUnit } from '../lib/group-by-unit.js';

type DocumentPickerProps = {
  value: string | null;
  onChange: (documentId: string) => void;
};

/** The question PDF that represents a unit for verification: the extracted one, else the first. */
function representativeQuestion(questions: Document[]): Document | undefined {
  const extracted = questions.find(
    (doc) => doc.status === 'extracted' || doc.status === 'completed' || doc.status === 'published',
  );
  return extracted ?? questions[0];
}

/**
 * The unit picker that drives verification. One entry per uploaded unit (module › chapter · section),
 * resolving to that unit's question PDF — answer and solution files are never offered here, since only
 * the question extracts into verifiable questions.
 */
export function DocumentPicker({ value, onChange }: DocumentPickerProps): JSX.Element {
  const { data, isPending, isError } = useDocuments();

  if (isPending) return <LoadingState label="Loading documents…" />;
  if (isError) return <p className="error">Could not reach the API. Is it running on :4000?</p>;

  const units: { unit: DocumentUnit; doc: Document }[] = groupByUnit(data.items).flatMap((unit) => {
    const doc = representativeQuestion(unit.questions);
    return doc ? [{ unit, doc }] : [];
  });

  if (units.length === 0) {
    return <p className="muted">No question PDFs yet. Cut &amp; upload a unit to see it here.</p>;
  }

  return (
    <select value={value ?? ''} onChange={(event) => { onChange(event.target.value); }}>
      <option value="" disabled>
        Select a unit to verify…
      </option>
      {units.map(({ unit, doc }) => (
        <option key={unit.key} value={doc.id}>
          {unit.module} › {unit.title} [{doc.status}]
        </option>
      ))}
    </select>
  );
}
