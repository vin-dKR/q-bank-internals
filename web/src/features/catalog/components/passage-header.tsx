import { type JSX, useState } from 'react';
import { Button, IconCheck, IconEdit, IconLayers, IconX, type PassageViewModel, PassageView } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';

/**
 * The header of a comprehension group on the Questions browse: the shared passage, editable in place.
 * Read mode renders through the SAME {@link PassageView} every surface uses (one concept, one look),
 * with an "Edit passage" action; edit mode swaps in a text editor. Saving rewrites the passage on
 * every sibling row of the group (the API updates all rows keyed by `group_id`). The passage FIGURE is
 * not edited here — like question figures, cropping needs the source page, so it stays a Verify action.
 */
export function PassageHeader({
  groupId,
  passage,
  count,
  onSave,
  pending = false,
}: {
  groupId: string;
  passage: PassageViewModel;
  /** How many sub-questions share this passage (shown as context). */
  count: number;
  /** Persist the edited passage text for the whole group. */
  onSave: (groupId: string, passage: string) => void;
  /** True while this group's passage write is in flight. */
  pending?: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(passage.text);

  const startEdit = (): void => {
    setDraft(passage.text);
    setEditing(true);
  };
  const save = (): void => {
    if (draft !== passage.text) onSave(groupId, draft);
    setEditing(false);
  };

  if (!editing) {
    return (
      <PassageView
        passage={passage}
        count={count}
        actions={
          <Button
            size="xs"
            variant="ghost"
            title="Edit this passage — the change applies to every question in the group"
            onClick={startEdit}
          >
            <IconEdit /> Edit passage
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
          <IconLayers /> Passage
        </span>
        <span className="text-xs text-ink-3">
          {count} question{count === 1 ? '' : 's'} share this passage
        </span>
        <span className="flex-1" />
        <Button size="xs" variant="primary" disabled={pending} title="Save the passage to every question in the group" onClick={save}>
          <IconCheck /> {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button size="xs" variant="ghost" disabled={pending} title="Discard your edits" onClick={() => { setEditing(false); }}>
          <IconX /> Cancel
        </Button>
      </div>
      <EditableLatexValue value={draft} onChange={setDraft} multiline placeholder="Click to write the passage" />
      {passage.images.length > 0 ? (
        <p className="m-0 text-xs text-ink-3">The passage figure is edited in Verify.</p>
      ) : null}
    </div>
  );
}
