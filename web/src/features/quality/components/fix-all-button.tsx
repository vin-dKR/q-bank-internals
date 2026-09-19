import type { JSX } from 'react';
import { ANOMALY_GROUP_LABELS, ANOMALY_KINDS, type AnomalyGroup, type AnomalyKind, type BulkFixPlan, type BulkFixPlanId } from '@ingest/contracts';
import { Button, Spinner, useConfirm } from '../../../shared/ui/index.js';
import { useApplyBulkFix, useBulkFixes } from '../hooks/use-quality.js';
import { kindsInGroup } from '../lib/anomaly-display.js';

/**
 * The rules a plan can fix outright. A rule with no entry here needs a person or the AI — there is no
 * button for it, rather than a button that quietly does nothing.
 */
const PLAN_FOR_RULE: Partial<Record<AnomalyKind, BulkFixPlanId>> = {
  type_nonstandard: 'question_type_spelling',
  latex_corrupted_escape: 'latex_corrupted_escape',
  latex_outside_delimiters: 'latex_wrap_math',
  option_labels_not_letters: 'option_labels_to_letters',
  answer_not_in_options: 'answer_option_label',
};

/** The plans behind the current selection: one rule's, or every fixable rule's in the selected group. */
function plansFor(kind: AnomalyKind | '', group: AnomalyGroup | ''): BulkFixPlanId[] {
  if (kind !== '') {
    const plan = PLAN_FOR_RULE[kind];
    return plan ? [plan] : [];
  }
  if (group === '') return [];
  return [...new Set(kindsInGroup(group).map((rule) => PLAN_FOR_RULE[rule]).filter((plan): plan is BulkFixPlanId => plan !== undefined))];
}

/**
 * "Fix all" for what is selected on the left: one rule's deterministic plan, or — with a whole group picked
 * (LaTeX rendering, say) — every fixable rule in it, run one after another. Shown only when something in the
 * selection HAS such a plan and actually affects questions, and always behind a confirmation naming the
 * count, because it rewrites live questions.
 *
 * The plans run over every affected question in the bank: they are mechanical rewrites with nothing to
 * decide, so they are not narrowed by the exam/subject/chapter filters. The confirmation says so.
 */
export function FixAllButton({ kind, group = '' }: { kind: AnomalyKind | ''; group?: AnomalyGroup | '' }): JSX.Element | null {
  const plans = useBulkFixes();
  const apply = useApplyBulkFix();
  const [confirm, confirmDialog] = useConfirm();

  const wanted = plansFor(kind, group);
  const definitions = wanted
    .map((plan) => plans.data?.plans.find((row) => row.plan === plan))
    .filter((definition): definition is BulkFixPlan => definition !== undefined && definition.affected > 0);
  if (definitions.length === 0) return null;

  const total = definitions.reduce((sum, definition) => sum + definition.affected, 0);
  const what = kind !== '' ? ANOMALY_KINDS[kind].label : group !== '' ? ANOMALY_GROUP_LABELS[group] : '';

  const run = async (): Promise<void> => {
    const confirmed = await confirm({
      title: definitions.length === 1 ? `${definitions[0]?.label ?? ''}?` : `Fix ${what.toLowerCase()} — ${String(definitions.length)} automatic fixes?`,
      body:
        `${total.toLocaleString()} live questions will be rewritten, along with their ingest staging copies. ` +
        (definitions.length === 1
          ? (definitions[0]?.description ?? '')
          : definitions.map((definition) => `${definition.label} (${definition.affected.toLocaleString()})`).join('; ')) +
        '. This covers every affected question in the bank, not only the ones your filters show.',
      confirmLabel: `Fix ${total.toLocaleString()}`,
    });
    if (!confirmed) return;
    // One plan at a time: each rewrite is independent, and a failure stops the rest rather than half-running
    // them silently (the failing plan's own error toast says which).
    for (const definition of definitions) await apply.mutateAsync(definition.plan);
  };

  return (
    <>
      <Button variant="primary" size="xs" disabled={apply.isPending} onClick={() => { void run(); }}>
        {apply.isPending ? <Spinner /> : null}
        Fix all {total.toLocaleString()} automatically
      </Button>
      {confirmDialog}
    </>
  );
}
