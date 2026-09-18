import { type JSX, useRef, useState } from 'react';
import { AI_BATCH_SIZE, AI_FIX_FIELDS, type AiFixField, type AnomalyKind } from '@ingest/contracts';
import { Button, IconSparkle, Spinner, useConfirm, useToast } from '../../../shared/ui/index.js';
import { useAiBatch } from '../hooks/use-quality.js';
import { fieldNeeds, planFor } from '../lib/rule-fields.js';
import type { QualityFilterState } from '../types.js';

const FIELD_LABELS: Record<AiFixField, string> = {
  topic: 'Topic',
  answer: 'Answer',
  solution: 'Solution',
  level: 'Level',
  structure: 'Structure',
};

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
}: {
  filters: QualityFilterState;
  /** Per-rule counts for the current filters — what this selection is actually missing. */
  counts: readonly { kind: AnomalyKind; count: number }[];
  /** Questions the current filters match — what the run will walk through. */
  matching: number;
  /** True while that count is still being fetched, so the button never offers a number it does not have. */
  loading: boolean;
}): JSX.Element {
  const plan = planFor(filters.kind, filters.group, counts);
  // With a rule chosen, "missing" means missing under THAT rule — otherwise Answer would report the
  // subjective rule's 273 while the selected "Answer missing" matches nothing.
  const needs = fieldNeeds(filters.kind === '' ? counts : counts.filter((row) => row.kind === filters.kind));
  const [fields, setFields] = useState<Set<AiFixField>>(new Set(plan.fields));
  const [overwrite, setOverwrite] = useState(plan.overwrite);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);

  // The selection decides the sensible default: picking "Topic missing", or a chapter whose answers are all
  // present, asks for a topic and nothing else — so a run never regenerates a field that is already filled.
  // Re-derived whenever the selection OR its counts change; the operator can still tick what they like, and
  // a run in progress is never re-based under itself.
  const selection = `${filters.group}|${filters.kind}|${filters.exam}|${filters.subject}|${filters.chapter}|${plan.fields.join(',')}`;
  const lastSelection = useRef(selection);
  if (lastSelection.current !== selection && !running) {
    lastSelection.current = selection;
    setFields(new Set(plan.fields));
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
    const confirmed = await confirm({
      title: `Run the AI on ${matching.toLocaleString()} question${matching === 1 ? '' : 's'}?`,
      body:
        `It works through them ${String(AI_BATCH_SIZE)} at a time, proposing ${[...fields].map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}. ` +
        (overwrite
          ? 'Values already stored in those fields WILL be replaced. '
          : 'Fields that already have a value are left untouched. ') +
        'Nothing is written to the bank — every result waits for your approval below. You can stop the run at any point.',
      confirmLabel: 'Start the run',
    });
    if (!confirmed) return;

    stop.current = false;
    setRunning(true);
    setProgress({ done: 0, proposed: 0, failed: 0, undecided: 0, skipped: 0, blocked: 0, total: matching });
    let cursor: string | null = null;
    try {
      do {
        const result = await batch.mutateAsync({
          fields: [...fields],
          filters: {
            status: filters.status,
            ...(filters.group !== '' && { group: filters.group }),
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
          total: current?.total ?? matching,
        }));
        cursor = result.nextCursor;
      } while (cursor !== null && !stopped());
      success(stopped() ? 'Run stopped' : 'Run finished', 'Review the proposals below, then apply them.');
    } finally {
      setRunning(false);
    }
  };

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink">Fix with AI</span>
        {AI_FIX_FIELDS.map((field) => {
          const need = needs[field];
          return (
            <label key={field} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-2">
              <input
                type="checkbox"
                className="size-4 w-auto accent-brand"
                checked={fields.has(field)}
                disabled={running}
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
              {need !== null ? (
                <span className={need > 0 ? 'text-ink-3' : 'text-ok'}>
                  {need > 0 ? `(${need.toLocaleString()} missing)` : '(all filled)'}
                </span>
              ) : null}
            </label>
          );
        })}
        {running ? (
          <Button variant="danger" size="xs" onClick={() => { stop.current = true; }}>Stop</Button>
        ) : (
          <Button
            variant="primary"
            size="xs"
            disabled={fields.size === 0 || matching === 0 || loading}
            onClick={() => { void run(); }}
          >
            <IconSparkle />
            {loading ? 'Counting…' : `Run on ${matching.toLocaleString()} filtered question${matching === 1 ? '' : 's'}`}
          </Button>
        )}
        {running ? <Spinner className="text-ink-3" /> : null}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          className="size-4 w-auto accent-brand"
          checked={overwrite}
          disabled={running}
          onChange={(event) => { setOverwrite(event.target.checked); }}
        />
        Replace values that are already stored
        <span className="text-ink-3">
          {overwrite
            ? '— use this when the stored value is what is wrong'
            : '— off: a field that already has a value is skipped, not sent to the AI'}
        </span>
      </label>

      {progress ? (
        <div className="flex flex-col gap-1">
          <span className="h-2 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${String(percent)}%` }} />
          </span>
          <span className="text-xs text-ink-2">
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} read ·{' '}
            <span className="text-ok">{progress.proposed.toLocaleString()} proposed</span>
            {progress.skipped > 0 ? ` · ${progress.skipped.toLocaleString()} already filled in` : ''}
            {progress.blocked > 0
              ? ` · ${progress.blocked.toLocaleString()} need an exam/subject set (or have no syllabus) before a topic can be matched`
              : ''}
            {progress.undecided > 0 ? ` · ${progress.undecided.toLocaleString()} the AI could not decide` : ''}
            {progress.failed > 0 ? ` · ${progress.failed.toLocaleString()} failed` : ''}
          </span>
        </div>
      ) : (
        <p className="m-0 text-xs text-ink-3">
          Picked for you because {plan.reason}. Narrow the filters above, adjust the fields if you need to, and run —
          results wait for your approval.
        </p>
      )}
      {confirmDialog}
    </div>
  );
}
