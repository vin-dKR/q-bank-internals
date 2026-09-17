import { type JSX, useState } from 'react';
import type { DictionaryEntry, UpdateDictionaryEntry } from '@ingest/contracts';
import { Badge, Button, IconCheck, IconEdit, IconTrash } from '../../../shared/ui/index.js';

/** Column widths shared between the table header and every row, so the two always line up. */
export const DICT_COL = {
  name: 'min-w-0 flex-1',
  aliases: 'hidden lg:flex min-w-0 w-[30%] items-center gap-1',
  used: 'w-14 shrink-0 text-right tabular-nums',
  actions: 'flex w-16 shrink-0 items-center justify-end gap-0.5',
} as const;

/** How many alias chips to show inline before collapsing the rest into a "+N" chip. */
const MAX_ALIAS_CHIPS = 3;

type DictionaryRowProps = {
  entry: DictionaryEntry;
  /** OPEN-vocab dimensions can delete; closed ones only edit name/aliases. */
  deletable: boolean;
  /** Resolved parent name (subject for a chapter, chapter for a topic), shown as scope context. */
  scopeName?: string | null;
  saving: boolean;
  onSave: (body: UpdateDictionaryEntry) => Promise<void>;
  onDelete: () => void;
};

/** Parse a comma-separated aliases field into trimmed, non-empty spellings. */
function parseAliases(text: string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** A small muted spelling chip. */
function AliasChip({ children }: { children: string }): JSX.Element {
  return (
    <span className="max-w-[9rem] truncate rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">{children}</span>
  );
}

/**
 * One dictionary entry as a table row: its canonical name (+ closed-vocab kind/rank badge and parent
 * scope), alias spellings, bank-usage count, and hover-revealed edit / delete actions. Editing happens
 * in-place (name + aliases); delete is guarded by the panel's confirm and disabled while the entry is
 * still used by bank questions.
 */
export function DictionaryRow({
  entry,
  deletable,
  scopeName,
  saving,
  onSave,
  onDelete,
}: DictionaryRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [aliases, setAliases] = useState(entry.aliases.join(', '));

  const startEdit = (): void => {
    setName(entry.name);
    setAliases(entry.aliases.join(', '));
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    await onSave({ name: name.trim(), aliases: parseAliases(aliases) });
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex flex-col gap-2.5 bg-surface-2/30 px-3 py-3">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Name</span>
            <input
              type="text"
              className="w-full"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              placeholder="Display name"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Also known as</span>
            <input
              type="text"
              className="w-full"
              value={aliases}
              onChange={(event) => { setAliases(event.target.value); }}
              placeholder="Alternate spellings, comma-separated"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="xs" disabled={saving || !name.trim()} onClick={() => void save()}>
            <IconCheck /> Save
          </Button>
          <Button variant="ghost" size="xs" disabled={saving} onClick={() => { setEditing(false); }}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  const extraChips = entry.aliases.length - MAX_ALIAS_CHIPS;

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2/40">
      <div className={DICT_COL.name}>
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{entry.name}</span>
          {entry.kind ? <Badge tone="info" dot={false}>{entry.kind}</Badge> : null}
          {entry.rank !== null ? <Badge tone="neutral" dot={false}>{`rank ${String(entry.rank)}`}</Badge> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <code className="truncate">{entry.key}</code>
          {scopeName ? <span className="truncate">· in {scopeName}</span> : null}
        </div>
      </div>

      <div className={DICT_COL.aliases}>
        {entry.aliases.length === 0 ? (
          <span className="text-xs text-ink-3">—</span>
        ) : (
          <>
            {entry.aliases.slice(0, MAX_ALIAS_CHIPS).map((alias) => (
              <AliasChip key={alias}>{alias}</AliasChip>
            ))}
            {extraChips > 0 ? <span className="text-xs text-ink-3">{`+${String(extraChips)}`}</span> : null}
          </>
        )}
      </div>

      <div className={`${DICT_COL.used} text-sm text-ink-3`}>{entry.questionCount.toLocaleString()}</div>

      <div className={`${DICT_COL.actions} opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100`}>
        <Button variant="ghost" size="xs" onClick={startEdit} aria-label={`Edit ${entry.name}`}>
          <IconEdit />
        </Button>
        {deletable ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={entry.questionCount > 0}
            title={entry.questionCount > 0 ? 'In use by bank questions' : `Delete ${entry.name}`}
            onClick={onDelete}
            aria-label={`Delete ${entry.name}`}
            className="hover:bg-bad-soft hover:text-bad disabled:hover:bg-transparent disabled:hover:text-ink-2"
          >
            <IconTrash />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
