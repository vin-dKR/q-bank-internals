import type { JSX } from 'react';
import { useRef } from 'react';
import type { MatchColumn, MatchData, MatchEntry } from '@ingest/contracts';
import { EditableLatexValue } from '../lib/latex.js';
import { Button } from './button.js';
import { IconButton } from './icon-button.js';
import { IconPlus, IconX } from './icons.js';
import { CropImageButton } from './crop-image-button.js';

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';
/** Familiar defaults for the first two columns; later columns receive globally unique safe labels. */
const SOURCE_LABEL_POOL = 'ABCDEFGHIJ';
const FIRST_TARGET_LABEL_POOL = 'pqrstuvwxyz';

/** Labels are identifiers in a matrix key, so compare their editable spelling defensively. */
function labelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = labelKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const label of labels) {
    const key = labelKey(label);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(label.trim());
    seen.add(key);
  }
  return [...duplicates];
}

/** Remove mapping references that no longer have a row/target after an explicit structural delete. */
function pruneKey(
  columns: readonly MatchColumn[],
  key: Record<string, string[]>,
): Record<string, string[]> {
  const sourceByKey = new Map<string, string>();
  for (const entry of columns[0]?.entries ?? []) {
    const normalized = labelKey(entry.label);
    if (normalized && !sourceByKey.has(normalized)) sourceByKey.set(normalized, entry.label.trim());
  }
  const targets = new Set(
    columns
      .slice(1)
      .flatMap((column) => column.entries.map((entry) => labelKey(entry.label)))
      .filter(Boolean),
  );
  const next: Record<string, string[]> = {};
  for (const [rawSource, rawTargets] of Object.entries(key)) {
    const source = sourceByKey.get(labelKey(rawSource));
    if (!source) continue;
    const usable = unique(rawTargets.filter((target) => targets.has(labelKey(target))));
    if (usable.length > 0) next[source] = usable;
  }
  return next;
}

function renameSourceKey(
  key: Record<string, string[]>,
  previous: string,
  next: string,
): Record<string, string[]> {
  const from = labelKey(previous);
  const to = next.trim();
  if (!from || !to) return key;
  const values = Object.entries(key)
    .filter(([label]) => labelKey(label) === from)
    .flatMap(([, targets]) => targets);
  if (values.length === 0) return key;
  const result = Object.fromEntries(
    Object.entries(key).filter(([label]) => labelKey(label) !== from),
  );
  result[to] = unique([...(result[to] ?? []), ...values]);
  return result;
}

function renameTargetReferences(
  key: Record<string, string[]>,
  previous: string,
  next: string,
): Record<string, string[]> {
  const from = labelKey(previous);
  const to = next.trim();
  if (!from || !to) return key;
  return Object.fromEntries(
    Object.entries(key).map(([source, targets]) => [
      source,
      unique(targets.map((target) => (labelKey(target) === from ? to : target))),
    ]),
  );
}

function removeSourceKey(
  key: Record<string, string[]>,
  labels: readonly string[],
): Record<string, string[]> {
  const removed = new Set(labels.map(labelKey).filter(Boolean));
  return Object.fromEntries(
    Object.entries(key).filter(([source]) => !removed.has(labelKey(source))),
  );
}

function removeTargetReferences(
  key: Record<string, string[]>,
  labels: readonly string[],
): Record<string, string[]> {
  const removed = new Set(labels.map(labelKey).filter(Boolean));
  return Object.fromEntries(
    Object.entries(key)
      .map(
        ([source, targets]) =>
          [source, targets.filter((target) => !removed.has(labelKey(target)))] as const,
      )
      .filter(([, targets]) => targets.length > 0),
  );
}

function nextEntryLabel(columns: readonly MatchColumn[], columnIndex: number): string {
  const current = columns[columnIndex];
  if (!current) return '1';
  const takenInColumn = new Set(current.entries.map((entry) => labelKey(entry.label)));
  if (columnIndex === 0) {
    for (const char of SOURCE_LABEL_POOL) if (!takenInColumn.has(labelKey(char))) return char;
    for (let ordinal = 1; ; ordinal += 1) {
      const candidate = `A${String(ordinal)}`;
      if (!takenInColumn.has(labelKey(candidate))) return candidate;
    }
  }

  // A key stores a bare target label, so every target label across every later column must be
  // globally unique. Column II retains the familiar p/q/r… convention; Column III onward uses a
  // column-prefixed alphanumeric identity (T31, T32 …), safe for the extraction/synthesis contract.
  const takenAcrossTargets = new Set(
    columns.slice(1).flatMap((column) => column.entries.map((entry) => labelKey(entry.label))),
  );
  if (columnIndex === 1) {
    for (const char of FIRST_TARGET_LABEL_POOL)
      if (!takenAcrossTargets.has(labelKey(char))) return char;
  }
  for (let ordinal = 1; ; ordinal += 1) {
    const candidate = `T${String(columnIndex + 1)}${String(ordinal)}`;
    if (!takenAcrossTargets.has(labelKey(candidate))) return candidate;
  }
}

/**
 * The structured editor for a match-the-column question: each column is a card of labelled entries
 * (two or more columns supported), and the correct matching is set by toggling, for every first-column
 * label, the later-column labels it matches. Emits a whole new {@link MatchData} on any edit; callers
 * can derive a canonical selected answer choice from a complete key. Titles/labels are plain text;
 * entry bodies edit as LaTeX.
 *
 * Shared (§ feature-slicing: shared/ui) — used by the verify card AND the question-bank browse editor.
 * `allowImages` is off in surfaces with no source page to crop from (the browse): existing entry
 * figures still render read-only, but can't be added or removed there.
 */
export function MatchTableEditor({
  value,
  onChange,
  onCropImage,
  disabled = false,
  allowImages = true,
}: {
  value: MatchData;
  onChange: (next: MatchData) => void;
  /** Arm a crop from the question page and resolve with the uploaded image URL (or `null` if cancelled). */
  onCropImage?: () => Promise<string | null>;
  disabled?: boolean;
  /** When false, entry figures are read-only (shown but not croppable/removable). Defaults to on. */
  allowImages?: boolean;
}): JSX.Element {
  const { columns, key } = value;
  /**
   * A controlled text input visits an empty value while an operator replaces a label. Remember the
   * label it started with until a non-empty blur can safely move its mapping, rather than deleting
   * the answer just because the first keystroke was Backspace.
   */
  const editingLabels = useRef(new Map<string, string>());
  // The labels an answer can point AT: every entry in the second column onward.
  const targetLabels = columns
    .slice(1)
    .flatMap((column) => column.entries.map((entry) => entry.label));
  const firstColumn = columns[0];

  const emit = (nextColumns: MatchColumn[], nextKey: Record<string, string[]> = key): void => {
    // Preserve future match-level annotations/provenance while editing the visible table.
    onChange({ ...value, columns: nextColumns, key: nextKey });
  };
  const entryIdentity = (colIndex: number, entryIndex: number): string =>
    `${String(colIndex)}:${String(entryIndex)}`;

  const patchColumn = (index: number, next: MatchColumn): void => {
    emit(columns.map((column, i) => (i === index ? next : column)));
  };
  const patchEntry = (colIndex: number, entryIndex: number, next: MatchEntry): void => {
    const column = columns[colIndex];
    if (!column) return;
    const nextColumns = columns.map((candidate, i) =>
      i === colIndex
        ? {
            ...column,
            entries: column.entries.map((entry, j) => (j === entryIndex ? next : entry)),
          }
        : candidate,
    );
    // Label keys are moved on blur (see `editingLabels`), so an in-progress rename cannot discard
    // a matching simply because its input temporarily contains an empty string.
    emit(nextColumns);
  };
  const beginLabelEdit = (colIndex: number, entryIndex: number, label: string): void => {
    const id = entryIdentity(colIndex, entryIndex);
    if (!editingLabels.current.has(id)) editingLabels.current.set(id, label);
  };
  const commitLabelEdit = (colIndex: number, entryIndex: number, currentValue: string): void => {
    const id = entryIdentity(colIndex, entryIndex);
    const previous = editingLabels.current.get(id);
    const entry = columns[colIndex]?.entries[entryIndex];
    const next = currentValue.trim();
    if (previous === undefined || !entry) return;
    // Do not manufacture a blank identifier. Retain the original identity until the operator gives
    // this row a real replacement; the matrix-choice generator will correctly remain disabled while
    // the table is incomplete.
    if (!next) return;
    editingLabels.current.delete(id);
    // Use the input's own value rather than relying on React to have committed the preceding
    // onChange render before blur. That makes label/key migration correct even under event batching.
    const nextColumns = columns.map((column, columnIndex) =>
      columnIndex === colIndex
        ? {
            ...column,
            entries: column.entries.map((candidate, candidateIndex) =>
              candidateIndex === entryIndex ? { ...candidate, label: currentValue } : candidate,
            ),
          }
        : column,
    );
    if (labelKey(previous) === labelKey(next)) {
      emit(nextColumns);
      return;
    }
    const renamed =
      colIndex === 0
        ? renameSourceKey(key, previous, next)
        : renameTargetReferences(key, previous, next);
    emit(nextColumns, pruneKey(nextColumns, renamed));
  };
  const addEntry = (colIndex: number): void => {
    const column = columns[colIndex];
    if (!column) return;
    patchColumn(colIndex, {
      ...column,
      entries: [
        ...column.entries,
        {
          label: nextEntryLabel(columns, colIndex),
          body: '',
          image: null,
        },
      ],
    });
  };
  const removeEntry = (colIndex: number, entryIndex: number): void => {
    const column = columns[colIndex];
    if (!column) return;
    const current = column.entries[entryIndex];
    if (!current) return;
    const id = entryIdentity(colIndex, entryIndex);
    const original = editingLabels.current.get(id);
    editingLabels.current.delete(id);
    const removedLabels = unique([current.label, ...(original ? [original] : [])]);
    const nextColumns = columns.map((candidate, i) =>
      i === colIndex
        ? { ...column, entries: column.entries.filter((_, j) => j !== entryIndex) }
        : candidate,
    );
    const withoutReference =
      colIndex === 0
        ? removeSourceKey(key, removedLabels)
        : removeTargetReferences(key, removedLabels);
    emit(nextColumns, pruneKey(nextColumns, withoutReference));
  };
  const addColumn = (): void => {
    emit([...columns, { title: `Column ${String(columns.length + 1)}`, entries: [] }]);
  };
  const removeColumn = (index: number): void => {
    if (columns.length <= 2) return; // a match needs at least two columns
    const removed = columns[index];
    if (!removed) return;
    const nextColumns = columns.filter((_, i) => i !== index);
    // If the source column goes away, the remaining table has a new source axis and no old mapping
    // can be trusted. A later-column removal only drops the targets it owned.
    const nextKey =
      index === 0
        ? {}
        : removeTargetReferences(
            key,
            removed.entries.map((entry) => entry.label),
          );
    emit(nextColumns, pruneKey(nextColumns, nextKey));
  };

  const toggleKey = (firstLabel: string, target: string): void => {
    const stored = Object.entries(key).find(
      ([source]) => labelKey(source) === labelKey(firstLabel),
    );
    const current = stored?.[1] ?? [];
    const next = current.some((label) => labelKey(label) === labelKey(target))
      ? current.filter((label) => labelKey(label) !== labelKey(target))
      : [...current, target];
    // Drop the row entirely when it maps to nothing, so an empty [] never lingers in the key.
    const nextKey = Object.fromEntries(
      Object.entries(key).filter(([label]) => labelKey(label) !== labelKey(firstLabel)),
    );
    if (next.length > 0) nextKey[firstLabel] = next;
    emit(columns, pruneKey(columns, nextKey));
  };

  const duplicateSourceLabels = duplicateLabels(
    firstColumn?.entries.map((entry) => entry.label) ?? [],
  );
  const duplicateTargetLabels = duplicateLabels(targetLabels);

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
            <div
              key={colIndex}
              className="flex min-w-56 flex-1 flex-col gap-2 rounded-lg border border-line bg-surface p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <input
                  className="w-full"
                  value={column.title}
                  placeholder={`Column ${String(colIndex + 1)} title`}
                  disabled={disabled}
                  onChange={(e) => {
                    patchColumn(colIndex, { ...column, title: e.target.value });
                  }}
                />
                {columns.length > 2 ? (
                  <IconButton
                    icon={<IconX />}
                    label={`Remove ${column.title || `column ${String(colIndex + 1)}`}`}
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      removeColumn(colIndex);
                    }}
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
                    onFocus={() => {
                      beginLabelEdit(colIndex, entryIndex, entry.label);
                    }}
                    onChange={(e) => {
                      patchEntry(colIndex, entryIndex, { ...entry, label: e.target.value });
                    }}
                    onBlur={(event) => {
                      commitLabelEdit(colIndex, entryIndex, event.currentTarget.value);
                    }}
                  />
                  <div className="flex-1">
                    <EditableLatexValue
                      value={entry.body}
                      onChange={(body) => {
                        patchEntry(colIndex, entryIndex, { ...entry, body });
                      }}
                      placeholder="Click to edit entry"
                    />
                    {entry.image ? (
                      <div className="mt-1 flex items-center gap-2">
                        <img
                          src={entry.image}
                          alt={`entry ${entry.label}`}
                          className="max-h-16 rounded border border-line bg-white"
                        />
                        {allowImages ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={disabled}
                            onClick={() => {
                              patchEntry(colIndex, entryIndex, { ...entry, image: null });
                            }}
                          >
                            Remove image
                          </Button>
                        ) : null}
                      </div>
                    ) : allowImages && onCropImage ? (
                      <div className="mt-1 flex items-center gap-2">
                        <CropImageButton
                          label="Image"
                          disabled={disabled}
                          onRequestCrop={onCropImage}
                          onCropped={(url) => {
                            patchEntry(colIndex, entryIndex, { ...entry, image: url });
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <IconButton
                    icon={<IconX />}
                    label="Remove entry"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      removeEntry(colIndex, entryIndex);
                    }}
                  />
                </div>
              ))}

              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => {
                  addEntry(colIndex);
                }}
              >
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
          firstColumn.entries.map((entry, entryIndex) => {
            const stored = Object.entries(key).find(
              ([source]) => labelKey(source) === labelKey(entry.label),
            );
            const selectedTargets = stored?.[1] ?? [];
            return (
              <div
                key={`${entry.label}-${String(entryIndex)}`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="w-9 flex-none text-center text-sm font-semibold text-ink">
                  {entry.label}
                </span>
                <span aria-hidden className="text-ink-3">
                  →
                </span>
                {targetLabels.map((target, targetIndex) => {
                  const active = selectedTargets.some(
                    (selected) => labelKey(selected) === labelKey(target),
                  );
                  return (
                    <button
                      key={`${target}-${String(targetIndex)}`}
                      type="button"
                      aria-pressed={active}
                      disabled={disabled}
                      className={
                        active
                          ? 'rounded-md border border-brand bg-brand-soft px-2 py-0.5 text-[13px] font-semibold text-brand'
                          : 'rounded-md border border-line px-2 py-0.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong'
                      }
                      onClick={() => {
                        toggleKey(entry.label, target);
                      }}
                    >
                      {target}
                    </button>
                  );
                })}
              </div>
            );
          })
        ) : (
          <p className="text-[13px] text-ink-3">
            Add entries to the first and later columns to set the matching.
          </p>
        )}
        {duplicateSourceLabels.length > 0 || duplicateTargetLabels.length > 0 ? (
          <p
            role="alert"
            className="m-0 rounded-md border border-warn/40 bg-warn-soft px-2.5 py-2 text-xs leading-relaxed text-warn"
          >
            {duplicateSourceLabels.length > 0 ? 'Source-row labels' : 'Target labels'} must be
            unique before answer choices can be generated. Rename the duplicate label
            {duplicateSourceLabels.length + duplicateTargetLabels.length > 1 ? 's' : ''}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
