import { type JSX, type ReactNode, useState } from 'react';
import type { ExamOption } from '@ingest/contracts';
import { Badge, Button, IconCheck } from '../../../shared/ui/index.js';
import { initials } from '../lib/initials.js';

/** Sets are compared order-independently — the entitlement is a set, not a sequence. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

type ExamAccessRowProps = {
  /** Used for the monogram + as the primary label. */
  name: string;
  subtitle: ReactNode;
  /** A small tag rendered next to the name (e.g. the org type). */
  tag?: ReactNode;
  allowedExams: string[];
  options: readonly ExamOption[];
  /** Human list of the default exams, shown when the account inherits the default. */
  defaultLabels: string;
  saving: boolean;
  onSave: (allowedExams: string[]) => void;
};

/**
 * One assignable account (an org or a user). COLLAPSED, it reads at a glance: a monogram, the name,
 * and whether it inherits the default or carries a custom set (shown as pills, with a left accent so
 * customised rows stand out when scanning). Clicking "Edit" reveals the exam toggles inline
 * (progressive disclosure keeps a long list scannable). Saving an empty set clears the override.
 *
 * The parent remounts this row (keyed by the persisted value) after a successful save, so it always
 * restarts collapsed and in sync — no prop→state syncing.
 */
export function ExamAccessRow({
  name,
  subtitle,
  tag,
  allowedExams,
  options,
  defaultLabels,
  saving,
  onSave,
}: ExamAccessRowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(allowedExams);
  const dirty = !sameSet(selected, allowedExams);
  const custom = allowedExams.length > 0;

  const toggle = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const cancel = (): void => {
    setSelected(allowedExams);
    setEditing(false);
  };

  return (
    <div
      className={
        'flex flex-col gap-3 border-b border-line px-1 py-3.5 last:border-b-0 ' +
        (custom ? 'border-l-2 border-l-brand pl-3' : '')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(name)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-ink">{name}</p>
              {tag}
            </div>
            <p className="truncate text-sm text-ink-2">{subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!editing && !custom ? (
            <Badge tone="neutral" dot={false}>
              Default
            </Badge>
          ) : null}
          {!editing && custom ? (
            <div className="hidden flex-wrap justify-end gap-1 sm:flex">
              {allowedExams.map((exam) => (
                <span
                  key={exam}
                  className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
                >
                  {exam}
                </span>
              ))}
            </div>
          ) : null}
          {!editing ? (
            <Button variant="ghost" size="xs" onClick={() => { setEditing(true); }}>
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => {
              const on = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { toggle(option.id); }}
                  className={
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                    (on
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2')
                  }
                >
                  {on ? <IconCheck /> : null}
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-2">
              {selected.length === 0
                ? `Empty → inherits default · ${defaultLabels}`
                : `${String(selected.length)} exam${selected.length === 1 ? '' : 's'} selected`}
            </span>
            <div className="flex items-center gap-2">
              {selected.length > 0 ? (
                <Button variant="ghost" size="xs" onClick={() => { setSelected([]); }}>
                  Inherit default
                </Button>
              ) : null}
              <Button variant="ghost" size="xs" disabled={saving} onClick={cancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                disabled={!dirty || saving}
                onClick={() => { onSave(selected); }}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
