import { type JSX, useState } from 'react';
import type { BulkFixPlan, BulkFixPlanId, BulkFixSample } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { cn } from '../../../shared/lib/cn.js';
import { Button, LoadingState, Spinner, useConfirm } from '../../../shared/ui/index.js';
import { useApplyBulkFix, useBulkFixes } from '../hooks/use-quality.js';
import { clampLatex, showControlChars } from '../lib/anomaly-display.js';

/** Characters of each side shown in the preview. */
const PREVIEW_LENGTH = 220;

/**
 * One line of the preview. The stored value is shown as raw source with its control characters made
 * visible — that IS the defect — while the corrected value is RENDERED with KaTeX, so what you approve is
 * what a student will see. The corrected source is kept underneath in small type for anyone checking it.
 */
function SampleRow({ sample }: { sample: BulkFixSample }): JSX.Element {
  const { before, after, field } = sample;
  const source = clampLatex(after, PREVIEW_LENGTH);
  return (
    <tr>
      <td className="align-top">
        <div className="text-xs font-medium text-ink">{sample.questionType ?? 'no type'}</div>
        <div className="text-xs text-ink-3">{sample.subject ?? 'no subject'}</div>
        <div className="mt-1 text-[11px] text-ink-3">{field}</div>
      </td>
      <td className="align-top font-mono text-[12px] text-bad">
        {showControlChars(clampLatex(before, PREVIEW_LENGTH)) || '(empty)'}
      </td>
      <td className="align-top">
        <div className="text-sm leading-relaxed text-ink">
          <RenderLatex text={source} />
        </div>
        <div className="mt-1 font-mono text-[11px] text-ink-3">{source}</div>
      </td>
    </tr>
  );
}

/** One plan as a tile: what it does, how many questions it touches, and its two actions. */
function PlanTile({
  plan,
  busy,
  open,
  onPreview,
  onApply,
}: {
  plan: BulkFixPlan;
  busy: boolean;
  open: boolean;
  onPreview: () => void;
  onApply: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-surface p-4 shadow-sm transition-colors',
        open ? 'border-brand ring-2 ring-brand-soft' : 'border-line',
      )}
    >
      <span className="text-sm font-semibold text-ink">{plan.label}</span>
      <span className="text-2xl font-semibold tabular-nums text-ink">{plan.affected.toLocaleString()}</span>
      <span className="line-clamp-3 text-xs text-ink-2" title={plan.description}>{plan.description}</span>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button size="xs" onClick={onPreview}>{open ? 'Hide preview' : 'Preview'}</Button>
        <Button variant="primary" size="xs" disabled={busy} onClick={onApply}>
          {busy ? <Spinner /> : null} Fix all
        </Button>
      </div>
    </div>
  );
}

/** The chosen plan's full before/after, shown under the tiles where it has the page width to be readable. */
function PlanPreview({ plan }: { plan: BulkFixPlan }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="text-sm font-semibold text-ink">{plan.label} — preview</div>
      {plan.groups.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-xs text-ink-3">
              Every change this fix makes — {plan.groups.length} distinct rewrite{plan.groups.length === 1 ? '' : 's'}.
            </p>
            <div className="table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Now</th><th>After the fix</th><th>Questions</th></tr>
                </thead>
                <tbody>
                  {plan.groups.map((group) => (
                    <tr key={`${group.before}-${group.after}`}>
                      <td className="font-mono text-[12px] text-bad">{group.before || '(empty)'}</td>
                      <td className="font-mono text-[12px] text-ok">{group.after}</td>
                      <td className="num">{group.questions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-xs text-ink-3">
              Every question is rewritten differently here, so these are {plan.samples.length} examples of {plan.affected.toLocaleString()}.
            </p>
            <div className="table-wrap">
              <table className="doc-table">
                <thead>
                  <tr><th>Question type · field</th><th>Now (stored source)</th><th>After the fix (as students see it)</th></tr>
                </thead>
                <tbody>
                  {plan.samples.map((sample) => (
                    <SampleRow key={`${sample.questionId}-${sample.field}`} sample={sample} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}

/**
 * The rule-only fixes: corrections with nothing to decide, applied to every affected question at once.
 * Each is previewed before it runs and confirmed, because it rewrites thousands of live questions.
 */
export function BulkFixCard(): JSX.Element {
  const plans = useBulkFixes();
  const apply = useApplyBulkFix();
  const [confirm, confirmDialog] = useConfirm();
  const [previewed, setPreviewed] = useState<BulkFixPlanId | null>(null);

  if (plans.isPending) return <LoadingState label="Checking what can be fixed automatically…" />;
  if (plans.isError) return <p className="error">Could not load the automatic fixes.</p>;

  const available = plans.data.plans.filter((plan) => plan.affected > 0);
  if (available.length === 0) {
    return <p className="muted">Nothing can be fixed automatically right now.</p>;
  }

  const run = async (plan: BulkFixPlan): Promise<void> => {
    const confirmed = await confirm({
      title: `${plan.label}?`,
      body: `${plan.affected.toLocaleString()} live questions will be rewritten, along with their ingest staging copies. Preview a few first if you have not already.`,
      confirmLabel: `Fix ${plan.affected.toLocaleString()}`,
    });
    if (confirmed) apply.mutate(plan.plan);
  };

  const openPlan = available.find((plan) => plan.plan === previewed);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[560px]:grid-cols-1">
        {available.map((plan) => (
          <PlanTile
            key={plan.plan}
            plan={plan}
            open={previewed === plan.plan}
            busy={apply.isPending && apply.variables === plan.plan}
            onPreview={() => { setPreviewed(previewed === plan.plan ? null : plan.plan); }}
            onApply={() => { void run(plan); }}
          />
        ))}
      </div>
      {openPlan ? <PlanPreview plan={openPlan} /> : null}
      <p className="m-0 text-xs text-ink-3">
        After a bulk fix, run a scan to refresh the counts — the fix writes the questions, the scan decides what is still wrong.
      </p>
      {confirmDialog}
    </div>
  );
}
