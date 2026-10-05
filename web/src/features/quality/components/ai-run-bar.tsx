import { type JSX, useRef, useState } from 'react';
import {
  AI_BATCH_SIZE,
  AI_FIX_FIELDS,
  ANOMALY_GROUP_LABELS,
  ANOMALY_KINDS,
  type AiFixField,
  type AnomalyGroup,
  type AnomalyKind,
} from '@ingest/contracts';
import { Button, useConfirm, useToast } from '../../../shared/ui/index.js';
import { useAiBatch } from '../hooks/use-quality.js';
import { planFor } from '../lib/rule-fields.js';
import type { QualityFilterState } from '../types.js';

const FIELD_LABELS: Record<AiFixField, string> = {
  topic: 'Topic',
  answer: 'Answer',
  solution: 'Solution',
  level: 'Level',
  structure: 'Structure',
};

/** Categories get only fields the AI can meaningfully suggest by default. Other categories remain usable. */
const CATEGORY_FIELDS: Partial<Record<AnomalyGroup, AiFixField[]>> = {
  answer: ['answer', 'solution'],
  topic: ['topic'],
  metadata: ['level'],
  structure: ['structure'],
};

/** Rules with a specific AI plan; other rules require the operator to choose fields explicitly. */
const PLANNED_KINDS = new Set<AnomalyKind>([
  'topic_missing',
  'topic_equals_chapter',
  'topic_looks_like_section',
  'answer_missing',
  'answer_missing_subjective',
  'answer_placeholder',
  'answer_not_in_options',
  'single_correct_multiple_answers',
  'integer_answer_not_numeric',
  'level_missing',
  'matrix_missing_columns',
  'group_missing_passage',
]);

/** What one run has done so far, kept while it walks the selection batch by batch. */
type Progress = {
  done: number;
  proposed: number;
  failed: number;
  undecided: number;
  skipped: number;
  blocked: number;
  total: number;
};

/**
 * Runs the AI over every question in the current selection, a batch at a time, and parks each result for
 * review. The loop lives here rather than on the server so the operator watches it move and can stop it at
 * any point — what is already proposed stays proposed.
 */
export function AiRunBar({
  filters,
  counts,
  matching,
  loading,
  countError,
  onRunningChange,
}: {
  filters: QualityFilterState;
  /** Per-rule counts for suggesting fields; unlike matching, these do not include text search. */
  counts: readonly { kind: AnomalyKind; count: number }[];
  /** Distinct questions in the current filtered queue, including text search. */
  matching: number;
  /** True while the question count or suggested-field counts are loading. */
  loading: boolean;
  countError: boolean;
  onRunningChange: (running: boolean) => void;
}): JSX.Element {
  const category = filters.kind !== '' ? ANOMALY_KINDS[filters.kind].group : filters.group;
  const hasScope = category !== '';
  const scopedMatching = hasScope ? matching : 0;
  const scopedLoading = hasScope && loading;
  const scopedCountError = hasScope && countError;

  // The API leaves the selected group/rule out of its per-rule counts so the issue picker can show all
  // choices. Bring the selected scope back when suggesting fields for this run.
  const scopedCounts = counts
    .filter((row) => category === '' || ANOMALY_KINDS[row.kind].group === category)
    .filter((row) => filters.kind === '' || row.kind === filters.kind);
  const plan = planFor(filters.kind, category, scopedCounts);
  const suggestedFields =
    filters.kind !== ''
      ? PLANNED_KINDS.has(filters.kind)
        ? plan.fields
        : []
      : category !== ''
        ? (CATEGORY_FIELDS[category] ?? [])
        : [];
  const [fields, setFields] = useState<Set<AiFixField>>(new Set(suggestedFields));
  const [overwrite, setOverwrite] = useState(plan.overwrite);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [runOutcome, setRunOutcome] = useState<'complete' | 'stopped' | 'failed' | null>(null);

  // The selection decides the sensible default: picking "Topic missing", or a chapter whose answers are all
  // present, asks for a topic and nothing else — so a run never regenerates a field that is already filled.
  // Re-derived whenever the selection OR its counts change; the operator can still tick what they like, and
  // a run in progress is never re-based under itself.
  const selection = `${filters.status}|${category}|${filters.kind}|${filters.severity}|${filters.exam}|${filters.subject}|${filters.chapter}|${suggestedFields.join(',')}`;
  const lastSelection = useRef(selection);
  if (lastSelection.current !== selection && !running) {
    lastSelection.current = selection;
    setFields(new Set(suggestedFields));
    setOverwrite(plan.overwrite);
  }
  // A ref, not state: the Stop button must be visible to a loop that is already running, and read through
  // a function so the compiler cannot assume the value it was given before the first batch still holds.
  const stop = useRef(false);
  const stopped = (): boolean => stop.current;
  const batch = useAiBatch();
  const [confirm, confirmDialog] = useConfirm();
  const { success } = useToast();

  const run = async (): Promise<void> => {
    if (
      category === '' ||
      fields.size === 0 ||
      scopedMatching === 0 ||
      scopedLoading ||
      scopedCountError
    )
      return;
    const confirmed = await confirm({
      title: `Run the AI on ${scopedMatching.toLocaleString()} question${scopedMatching === 1 ? '' : 's'}?`,
      body:
        `This run is limited to ${filters.kind !== '' ? ANOMALY_KINDS[filters.kind].label : ANOMALY_GROUP_LABELS[category]}. It works through the questions ${String(AI_BATCH_SIZE)} at a time, proposing ${[...fields].map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}. ` +
        (overwrite
          ? 'Values already stored in those fields WILL be replaced. '
          : 'Fields that already have a value are left untouched. ') +
        'Nothing is written to the bank — every result waits for your approval below. You can stop the run at any point.',
      confirmLabel: 'Start the run',
    });
    if (!confirmed) return;

    stop.current = false;
    setRunning(true);
    onRunningChange(true);
    setRunOutcome(null);
    setProgress({
      done: 0,
      proposed: 0,
      failed: 0,
      undecided: 0,
      skipped: 0,
      blocked: 0,
      total: scopedMatching,
    });
    let cursor: string | null = null;
    try {
      do {
        const result = await batch.mutateAsync({
          fields: [...fields],
          filters: {
            status: filters.status,
            group: category,
            ...(filters.kind !== '' && { kind: filters.kind }),
            ...(filters.severity !== '' && { severity: filters.severity }),
            ...(filters.exam !== '' && { exam: filters.exam }),
            ...(filters.subject !== '' && { subject: filters.subject }),
            ...(filters.chapter !== '' && { chapter: filters.chapter }),
            ...(filters.q.trim() !== '' && { q: filters.q.trim() }),
          },
          overwrite,
          ...(cursor !== null && { cursor }),
          limit: AI_BATCH_SIZE,
        });
        setProgress((current) => ({
          done: (current?.done ?? 0) + result.processed,
          proposed: (current?.proposed ?? 0) + result.proposed,
          failed: (current?.failed ?? 0) + result.failed,
          undecided: (current?.undecided ?? 0) + result.undecided,
          skipped: (current?.skipped ?? 0) + result.skipped,
          blocked: (current?.blocked ?? 0) + result.blocked,
          total: current?.total ?? scopedMatching,
        }));
        cursor = result.nextCursor;
      } while (cursor !== null && !stopped());
      setRunOutcome(stopped() ? 'stopped' : 'complete');
      success(
        stopped() ? 'Run stopped' : 'Run finished',
        'Review the proposals below, then apply them.',
      );
    } catch {
      // The batch mutation already shows the error; proposals from earlier batches remain reviewable.
      setRunOutcome('failed');
    } finally {
      setRunning(false);
      onRunningChange(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <h2 className="m-0 text-sm font-semibold text-ink">2. Generate suggestions</h2>
        <p className="m-0 mt-1 text-xs text-ink-3">
          Generation only creates proposals. Applying them below writes the bank.
        </p>
      </div>

      <fieldset className="m-0 border-0 p-0" disabled={!hasScope || running}>
        <legend className="mb-2 text-xs font-medium text-ink-2">What should the AI suggest?</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {AI_FIX_FIELDS.map((field) => {
            return (
              <label
                key={field}
                className="flex cursor-pointer items-center gap-2 text-sm text-ink-2"
              >
                <input
                  type="checkbox"
                  className="size-4 w-auto accent-brand"
                  checked={fields.has(field)}
                  onChange={() => {
                    setFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(field)) next.delete(field);
                      else next.add(field);
                      return next;
                    });
                  }}
                />
                {FIELD_LABELS[field]}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          className="size-4 w-auto accent-brand"
          checked={overwrite}
          disabled={!hasScope || running}
          onChange={(event) => {
            setOverwrite(event.target.checked);
          }}
        />
        Replace existing values
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p className="m-0 max-w-2xl text-xs text-ink-3">
          {!hasScope
            ? 'Choose an issue category or issue type in the filters above before generating suggestions.'
            : fields.size === 0
              ? 'Select at least one field for the AI to suggest.'
              : overwrite
                ? 'Existing values in the selected fields may be replaced in the suggestions.'
                : category === 'answer' && filters.kind === ''
                  ? 'Existing answers are skipped. To correct wrong answers, choose a specific issue type and enable replacement.'
                : 'Fields that already have a value will be skipped.'}
        </p>
        {running ? (
          <Button
            size="xs"
            onClick={() => {
              stop.current = true;
            }}
          >
            Stop run
          </Button>
        ) : (
          <Button
            variant="primary"
            size="xs"
            disabled={
              !hasScope ||
              fields.size === 0 ||
              scopedMatching === 0 ||
              scopedLoading ||
              scopedCountError
            }
            onClick={() => {
              void run();
            }}
          >
            {!hasScope
              ? 'Choose a category or issue type'
              : scopedLoading
                ? 'Counting questions…'
                : `Generate for ${scopedMatching.toLocaleString()} question${scopedMatching === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>

      {scopedCountError ? (
        <p role="alert" className="m-0 text-xs text-bad">
          Could not count matching questions. Check the filters and try again.
        </p>
      ) : null}

      {progress ? (
        <div
          className="flex flex-col gap-2 border-t border-line pt-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
            <span>
              {running
                ? 'Generating suggestions…'
                : runOutcome === 'failed'
                  ? 'Run stopped after an error'
                  : runOutcome === 'stopped'
                    ? 'Run stopped'
                    : 'Run finished'}
            </span>
            <span className="tabular-nums">
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()} questions
              checked
            </span>
          </div>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-ink-3 transition-[width]"
              style={{ width: `${String(percent)}%` }}
            />
          </span>
          <span className="text-xs text-ink-3">
            {progress.proposed.toLocaleString()} suggestions ready for review
            {progress.skipped > 0 ? ` · ${progress.skipped.toLocaleString()} already filled` : ''}
            {progress.blocked > 0
              ? ` · ${progress.blocked.toLocaleString()} need a subject or topics in Question taxonomy`
              : ''}
            {progress.undecided > 0
              ? ` · ${progress.undecided.toLocaleString()} could not be decided`
              : ''}
            {progress.failed > 0 ? ` · ${progress.failed.toLocaleString()} failed` : ''}
          </span>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  );
}
