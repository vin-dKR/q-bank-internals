import type { JSX } from 'react';
import type { MatchColumn, MatchData, MatchEntry } from '@ingest/contracts';
import { Button, IconButton, IconPlus, IconX } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';
/** Default label pool per column: A,B,C… for the first column; p,q,r… for the rest (JEE convention). */
const LABEL_POOLS = ['ABCDEFGHIJ', 'pqrstuvwxyz'] as const;

function nextLabel(taken: string[], pool: string): string {
  for (const char of pool) if (!taken.includes(char)) return char;
  return String(taken.length + 1);
}

/**
 * The structured editor for a match-the-column question: each column is a card of labelled entries
 * (2 or 3 columns supported), and the correct matching is set by toggling, for every first-column
 * label, the later-column labels it matches. Emits a whole new {@link MatchData} on any edit — the
 * card mirrors `key` into the flat answer. Titles/labels are plain text; entry bodies edit as LaTeX.
 */
export function MatchTableEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: MatchData;
  onChange: (next: MatchData) => void;
  disabled?: boolean;
}): JSX.Element {
  const { columns, key } = value;
  // The labels an answer can point AT: every entry in the second column onward.
  const targetLabels = columns.slice(1).flatMap((column) => column.entries.map((entry) => entry.label));
  const firstColumn = columns[0];

  const patchColumn = (index: number, next: MatchColumn): void => {
    onChange({ ...value, columns: columns.map((column, i) => (i === index ? next : column)) });
  };
  const patchEntry = (colIndex: number, entryIndex: number, next: MatchEntry): void => {
    const column = columns[colIndex];
    if (!column) return;
    patchColumn(colIndex, {
      ...column,
      entries: column.entries.map((entry, i) => (i === entryIndex ? next : entry)),
    });
  };
  const addEntry = (colIndex: number): void => {
    const column = columns[colIndex];
    if (!column) return;
    const taken = column.entries.map((entry) => entry.label);
    patchColumn(colIndex, {
      ...column,
      entries: [...column.entries, { label: nextLabel(taken, colIndex === 0 ? LABEL_POOLS[0] : LABEL_POOLS[1]), body: '' }],
    });
  };
  const removeEntry = (colIndex: number, entryIndex: number): void => {
    const column = columns[colIndex];
    if (!column) return;
    patchColumn(colIndex, { ...column, entries: column.entries.filter((_, i) => i !== entryIndex) });
  };
  const addColumn = (): void => {
    onChange({
      ...value,
      columns: [...columns, { title: `Column ${String(columns.length + 1)}`, entries: [] }],
    });
  };
  const removeColumn = (index: number): void => {
    if (columns.length <= 2) return; // a match needs at least two columns
    onChange({ ...value, columns: columns.filter((_, i) => i !== index) });
  };

  const toggleKey = (firstLabel: string, target: string): void => {
    const current = key[firstLabel] ?? [];
    const next = current.includes(target)
      ? current.filter((label) => label !== target)
      : [...current, target];
    // Drop the row entirely when it maps to nothing, so an empty [] never lingers in the key.
    const nextKey = Object.fromEntries(Object.entries(key).filter(([label]) => label !== firstLabel));
    if (next.length > 0) nextKey[firstLabel] = next;
    onChange({ ...value, key: nextKey });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2 p-2.5">
      <div className="flex items-center justify-between">
        <span className={FIELD_LABEL}>Match the column</span>
        <Button size="xs" disabled={disabled} onClick={addColumn}>
          <IconPlus /> Add column
        </Button>
      </div>

      {/* Columns scroll horizontally inside their own track so 3 wide columns never break the card. */}
      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-2.5">
          {columns.map((column, colIndex) => (
            <div key={colIndex} className="flex min-w-56 flex-1 flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  className="w-full"
                  value={column.title}
                  placeholder={`Column ${String(colIndex + 1)} title`}
                  disabled={disabled}
                  onChange={(e) => { patchColumn(colIndex, { ...column, title: e.target.value }); }}
                />
                {columns.length > 2 ? (
                  <IconButton
                    icon={<IconX />}
                    label={`Remove ${column.title || `column ${String(colIndex + 1)}`}`}
                    size="sm"
                    disabled={disabled}
                    onClick={() => { removeColumn(colIndex); }}
                  />
                ) : null}
              </div>

              {column.entries.map((entry, entryIndex) => (
                <div key={entryIndex} className="flex items-start gap-1.5">
                  <input
                    className="mt-1 w-9 flex-none text-center font-semibold"
                    value={entry.label}
                    aria-label={`Label for entry ${String(entryIndex + 1)}`}
                    disabled={disabled}
                    onChange={(e) => { patchEntry(colIndex, entryIndex, { ...entry, label: e.target.value }); }}
                  />
                  <div className="flex-1">
                    <EditableLatexValue
                      value={entry.body}
                      onChange={(body) => { patchEntry(colIndex, entryIndex, { ...entry, body }); }}
                      placeholder="Click to edit entry"
                    />
                  </div>
                  <IconButton
                    icon={<IconX />}
                    label="Remove entry"
                    size="sm"
                    disabled={disabled}
                    onClick={() => { removeEntry(colIndex, entryIndex); }}
                  />
                </div>
              ))}

              <Button variant="ghost" size="xs" disabled={disabled} onClick={() => { addEntry(colIndex); }}>
                <IconPlus /> Add entry
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* The correct matching: for each first-column label, toggle the later-column labels it maps to. */}
      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>Correct matching</span>
        {firstColumn && firstColumn.entries.length > 0 && targetLabels.length > 0 ? (
          firstColumn.entries.map((entry) => (
            <div key={entry.label} className="flex flex-wrap items-center gap-1.5">
              <span className="w-9 flex-none text-center text-sm font-semibold text-ink">{entry.label}</span>
              <span aria-hidden className="text-ink-3">→</span>
              {targetLabels.map((target) => {
                const active = (key[entry.label] ?? []).includes(target);
                return (
                  <button
                    key={target}
                    type="button"
                    aria-pressed={active}
                    disabled={disabled}
                    className={
                      active
                        ? 'rounded-md border border-brand bg-brand-soft px-2 py-0.5 text-[13px] font-semibold text-brand'
                        : 'rounded-md border border-line px-2 py-0.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong'
                    }
                    onClick={() => { toggleKey(entry.label, target); }}
                  >
                    {target}
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <p className="text-[13px] text-ink-3">Add entries to the first and later columns to set the matching.</p>
        )}
      </div>
    </div>
  );
}
