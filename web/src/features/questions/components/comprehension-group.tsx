import type { JSX } from 'react';
import { useState } from 'react';
import type { ReExtractedGroup, ReExtractSource } from '@ingest/contracts';
import { Badge, Button, IconLayers, IconScan, useToast } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { questionsApi } from '../api/questions.api.js';

type Props = {
  documentId: string;
  /** The comprehension group's stable id — the whole-group re-read is addressed by it. */
  groupId: string;
  /** How many sub-questions share this passage (shown as context). */
  count: number;
  /** The current shared-passage draft value (from the first sibling's draft). */
  passage: string;
  /** True when any sibling in the group has unsaved edits — shows the indicator. */
  dirty: boolean;
  /** The group's question type, passed through to the re-read for symmetry with the single path. */
  questionType: string | null;
  /** Pause the re-read control while a whole-document crop run is in flight. */
  disabled?: boolean;
  /** Redirect the page read to a sibling answer/solution page, exactly like the single re-extract. */
  reExtractSource?: ReExtractSource | undefined;
  /** Write the edited passage back onto EVERY sibling's draft so they save identically. */
  onPassageChange: (value: string) => void;
  /** Apply a whole-group re-read: the fresh passage (to all rows) + each sub-question's fields. */
  onReExtracted: (result: ReExtractedGroup) => void;
};

/**
 * The shared-passage header for a comprehension group on the Verify screen (BLA-125). Renders once
 * above the group's sub-question cards: the passage is edited here (one editor, fanned across every
 * sibling's draft by {@link Props.onPassageChange}) and a single "re-extract passage + all questions"
 * action re-reads the whole block from the page — the group companion to the card's per-question
 * "re-extract with this type". Errors are toasted; the passage/questions only change on a successful
 * read, so a failed re-read never wipes the current values.
 */
export function ComprehensionGroupPanel({
  documentId,
  groupId,
  count,
  passage,
  dirty,
  questionType,
  disabled = false,
  reExtractSource,
  onPassageChange,
  onReExtracted,
}: Props): JSX.Element {
  const toast = useToast();
  const [reading, setReading] = useState(false);

  const reExtract = async (): Promise<void> => {
    setReading(true);
    try {
      const result = await questionsApi.reExtractGroup(
        documentId,
        groupId,
        reExtractSource,
        questionType,
      );
      onReExtracted(result);
      toast.toast({
        tone: 'success',
        title: 'Re-extracted the passage',
        description: 'Review the passage and its questions, then Update to save.',
      });
    } catch (error) {
      toast.error(
        'Could not re-read the passage',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
          <IconLayers /> Passage
        </span>
        <span className="text-xs text-ink-3">
          {count} question{count === 1 ? '' : 's'} share this passage
        </span>
        {dirty ? <Badge tone="progress">Unsaved</Badge> : null}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="xs"
            disabled={reading || disabled}
            title="Re-read the passage and all its sub-questions from the page"
            onClick={() => { void reExtract(); }}
          >
            {reading ? '…' : <><IconScan /> Re-extract passage + all questions</>}
          </Button>
        </div>
      </div>
      <EditableLatexValue
        value={passage}
        onChange={onPassageChange}
        multiline
        placeholder="Click to edit the shared passage"
      />
    </div>
  );
}
