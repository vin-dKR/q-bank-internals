import type { JSX } from 'react';
import { useState } from 'react';
import type { ReExtractGroupMode, ReExtractedGroup, ReExtractSource } from '@ingest/contracts';
import {
  Badge,
  Button,
  CropImageButton,
  IconLayers,
  IconScan,
  IconSparkle,
  Spinner,
  useToast,
} from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { questionsApi } from '../api/questions.api.js';

type Props = {
  documentId: string;
  /** The comprehension group's passage id — the whole-group re-read + passage edit are addressed by it. */
  passageId: string;
  /** How many sub-questions share this passage (shown as context). */
  count: number;
  /** The current shared-passage draft text (from the passage entity). */
  passage: string;
  /** The shared passage figure (Supabase URL), or null when none is attached. */
  passageImage: string | null;
  /** True when this passage has unsaved edits — shows the indicator. */
  dirty: boolean;
  /** Pause the re-read control while a whole-document crop run is in flight. */
  disabled?: boolean;
  /** Redirect the page read to a sibling answer/solution page, exactly like the single re-extract. */
  reExtractSource?: ReExtractSource | undefined;
  /** Edit the shared passage in ONE place (the group's passage record) — no more sibling fan-out. */
  onPassageChange: (value: string) => void;
  /** Apply a whole-group re-read: the fresh passage (to the passage record) + each sub-question's fields. */
  onReExtracted: (result: ReExtractedGroup) => void;
  /** Dissolve this comprehension group back into standalone question cards. */
  onUngroup: () => void;
  /** Arm a one-shot crop of the shared passage figure from the page; resolves with the uploaded URL. */
  onRequestCrop: () => Promise<string | null>;
  /** Save (`url`) or clear (`null`) the shared passage figure. */
  onImageChange: (url: string | null) => void;
};

/**
 * The shared-passage header for a comprehension group on the Verify screen (BLA-125, v2). Renders once
 * above the group's sub-question cards: the passage is a first-class entity, edited HERE in one place
 * (no more copying it onto every sibling) and saved with a single PATCH. The operator explicitly picks
 * whether a re-read corrects only the passage or the passage plus member questions. Errors are toasted;
 * the passage/questions only change on a successful read, so a failed re-read never wipes current values.
 */
export function ComprehensionGroupPanel({
  documentId,
  passageId,
  count,
  passage,
  passageImage,
  dirty,
  disabled = false,
  reExtractSource,
  onPassageChange,
  onReExtracted,
  onUngroup,
  onRequestCrop,
  onImageChange,
}: Props): JSX.Element {
  const toast = useToast();
  const [reading, setReading] = useState(false);
  const [fixingLatex, setFixingLatex] = useState(false);
  // Default to the narrow operation: correcting a shared passage should not unexpectedly replace every
  // member question. The API default stays full-group for existing callers that do not send a mode.
  const [reExtractMode, setReExtractMode] = useState<ReExtractGroupMode>('passage_only');

  /** Clean the shared passage in place, just like the field-level LaTeX action on question/options. */
  const refinePassageLatex = async (): Promise<void> => {
    if (!passage.trim()) return;
    setFixingLatex(true);
    try {
      onPassageChange(await questionsApi.refine(passage));
      toast.success('Fixed passage LaTeX', 'Review the updated passage, then Update to save.');
    } catch (error) {
      toast.error(
        'Could not fix passage LaTeX',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setFixingLatex(false);
    }
  };

  const reExtract = async (): Promise<void> => {
    setReading(true);
    try {
      const result = await questionsApi.reExtractGroup(documentId, passageId, {
        mode: reExtractMode,
        ...(reExtractSource ? { source: reExtractSource } : {}),
      });
      onReExtracted(result);
      toast.toast({
        tone: 'success',
        title:
          reExtractMode === 'passage_only'
            ? 'Re-extracted the passage'
            : 'Re-extracted the passage and questions',
        description:
          reExtractMode === 'passage_only'
            ? 'Review the shared passage, then Update to save.'
            : 'Review the passage and its questions, then Update to save.',
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
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
            <IconLayers /> Passage
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Shared comprehension passage</p>
            <p className="text-xs text-ink-3">
              {count} question{count === 1 ? '' : 's'} use this same passage
            </p>
          </div>
          {dirty ? <Badge tone="progress">Unsaved</Badge> : null}
          <Button
            className="ml-auto shrink-0 whitespace-nowrap"
            variant="ghost"
            size="xs"
            disabled={fixingLatex || reading || disabled || !passage.trim()}
            title="Fix passage LaTeX with AI"
            onClick={() => {
              void refinePassageLatex();
            }}
          >
            {fixingLatex ? <Spinner /> : <IconSparkle />} Fix LaTeX
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <span className="shrink-0 text-xs font-semibold text-ink-2">Re-extract from source</span>
          <div className="segmented shrink-0" role="group" aria-label="Comprehension re-extract scope">
            <button
              type="button"
              className={`segmented__item whitespace-nowrap ${reExtractMode === 'passage_only' ? 'is-active' : ''}`}
              aria-pressed={reExtractMode === 'passage_only'}
              disabled={reading || fixingLatex || disabled}
              title="Re-read only the shared passage; keep every member question unchanged"
              onClick={() => {
                setReExtractMode('passage_only');
              }}
            >
              Passage only
            </button>
            <button
              type="button"
              className={`segmented__item whitespace-nowrap ${reExtractMode === 'passage_and_questions' ? 'is-active' : ''}`}
              aria-pressed={reExtractMode === 'passage_and_questions'}
              disabled={reading || fixingLatex || disabled}
              title="Re-read the shared passage and every member question"
              onClick={() => {
                setReExtractMode('passage_and_questions');
              }}
            >
              Passage + questions
            </button>
          </div>
          <Button
            className="shrink-0 whitespace-nowrap"
            variant="default"
            size="xs"
            disabled={reading || fixingLatex || disabled}
            title={
              reExtractMode === 'passage_only'
                ? 'Re-read only the shared passage from the source page'
                : 'Re-read the shared passage and every member question from the source pages'
            }
            onClick={() => {
              void reExtract();
            }}
          >
            {reading ? (
              <>
                <Spinner /> Re-extracting…
              </>
            ) : (
              <>
                <IconScan /> Re-extract
              </>
            )}
          </Button>
          <Button
            className="ml-auto shrink-0 whitespace-nowrap"
            variant="ghost"
            size="xs"
            disabled={reading || fixingLatex || disabled}
            title="Dissolve this group back into standalone questions"
            onClick={onUngroup}
          >
            Ungroup passage
          </Button>
        </div>
      </div>
      <EditableLatexValue
        value={passage}
        onChange={onPassageChange}
        multiline
        placeholder="Click to edit the shared passage"
      />
      {passageImage ? (
        <div className="mt-1 flex items-start gap-3">
          <img
            src={passageImage}
            alt="Shared passage figure"
            className="max-h-64 w-auto rounded-md border border-line"
          />
          <div className="flex flex-col items-start gap-1.5">
            <CropImageButton
              label="Replace image"
              disabled={disabled}
              onRequestCrop={onRequestCrop}
              onCropped={onImageChange}
            />
            <Button
              variant="ghost"
              size="xs"
              disabled={disabled}
              title="Remove the shared passage figure"
              onClick={() => {
                onImageChange(null);
              }}
            >
              Remove image
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1">
          <CropImageButton
            label="Crop passage image from page"
            disabled={disabled}
            onRequestCrop={onRequestCrop}
            onCropped={onImageChange}
          />
        </div>
      )}
    </div>
  );
}
