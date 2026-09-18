import type { JSX } from 'react';
import { AI_FILLABLE_FIELDS, type AiFillableField } from '@ingest/contracts';
import { IconSparkle, Spinner } from '../../../shared/ui/index.js';
import { useAiFilledSummary } from '../hooks/use-quality.js';

const FIELD_LABELS: Record<AiFillableField, string> = {
  topic: 'Topics',
  answer: 'Answers',
  solution: 'Solutions',
  level: 'Levels',
  structure: 'Structures',
};

/**
 * How much of the live bank holds AI-written data — kept separate from the problem tiles because it is not a
 * problem, it is provenance: these values were approved, but a human did not write them.
 */
export function AiFilledCard(): JSX.Element {
  const query = useAiFilledSummary();

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand [&>svg]:size-4">
          <IconSparkle />
        </span>
        <div className="flex flex-col">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Filled by AI</span>
          {query.isPending ? (
            <Spinner className="text-ink-3" />
          ) : query.isError ? (
            <span className="text-sm text-bad">Could not load</span>
          ) : (
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {query.data.questions.toLocaleString()}
              <span className="ml-1.5 text-xs font-normal text-ink-3">live questions</span>
            </span>
          )}
        </div>
      </div>
      {query.data ? (
        <div className="flex flex-wrap gap-2">
          {AI_FILLABLE_FIELDS.map((field) => (
            <span key={field} className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
              {FIELD_LABELS[field]} <span className="font-semibold tabular-nums text-ink">{query.data.byField[field].toLocaleString()}</span>
            </span>
          ))}
        </div>
      ) : null}
      <p className="m-0 basis-full text-xs text-ink-3">
        Values an AI worked out and an operator approved. Each question carries an <code>ai_filled</code> tag per
        field; editing that field by hand removes its tag.
      </p>
    </div>
  );
}
