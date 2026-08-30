import type { JSX } from 'react';
import { Combobox, Skeleton } from '../../../shared/ui/index.js';
import { useDocuments } from '../hooks/use-documents.js';
import { groupByUnit, representativeQuestion, unitDisplayLabel } from '../lib/group-by-unit.js';

type DocumentPickerProps = {
  value: string | null;
  onChange: (documentId: string) => void;
};

/**
 * The unit picker that drives verification: a searchable Combobox with one entry per uploaded unit
 * (module › chapter · section), resolving to that unit's question PDF — answer and solution files
 * are never offered here, since only the question extracts into verifiable questions.
 */
export function DocumentPicker({ value, onChange }: DocumentPickerProps): JSX.Element {
  const { data, isPending, isError } = useDocuments();

  // Shape-matched skeleton so the control doesn't height-jump into place (workspace session bar).
  if (isPending) return <Skeleton className="h-10 w-full" />;
  if (isError) return <p className="error">Could not reach the API. Is it running on :4000?</p>;

  const units = groupByUnit(data.items).flatMap((unit) => {
    const doc = representativeQuestion(unit.questions);
    return doc ? [{ unit, doc }] : [];
  });

  if (units.length === 0) {
    return <p className="muted">No question PDFs yet. Cut &amp; upload a unit to see it here.</p>;
  }

  // The shared Combobox is string-valued, so map display labels ↔ document ids. A rare label
  // collision between distinct units gets a numeric suffix so every option stays pickable.
  const labelToId = new Map<string, string>();
  const idToLabel = new Map<string, string>();
  for (const { doc } of units) {
    const base = unitDisplayLabel(doc);
    let label = `${base} — ${doc.status}`;
    for (let n = 2; labelToId.has(label); n += 1) label = `${base} (${String(n)}) — ${doc.status}`;
    labelToId.set(label, doc.id);
    idToLabel.set(doc.id, label);
  }
  // A documentId arriving from a bank search or a restored URL may not be its unit's representative
  // doc — give every question doc a label so the session bar never shows an empty input for an open
  // document.
  for (const doc of data.items) {
    if (doc.kind === 'question' && !idToLabel.has(doc.id)) {
      idToLabel.set(doc.id, `${unitDisplayLabel(doc)} — ${doc.status}`);
    }
  }

  return (
    <label className="block w-full">
      <span className="sr-only">Unit to verify</span>
      <Combobox
        value={value ? idToLabel.get(value) ?? '' : ''}
        onChange={(label) => {
          const id = labelToId.get(label);
          if (id) onChange(id);
        }}
        options={[...labelToId.keys()]}
        allowCustom={false}
        placeholder="Select a unit to verify…"
      />
    </label>
  );
}
