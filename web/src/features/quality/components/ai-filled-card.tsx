import type { JSX } from 'react';
import { AI_FILLABLE_FIELDS, type AiFillableField } from '@ingest/contracts';
import { Spinner } from '../../../shared/ui/index.js';
import { useAiFilledSummary } from '../hooks/use-quality.js';

const FIELD_LABELS: Record<AiFillableField, string> = {
  topic: 'Topics',
  answer: 'Answers',
  solution: 'Solutions',
  level: 'Levels',
  structure: 'Structures',
};

/** Approved AI-written values in the live bank, shown as provenance rather than an issue. */
export function AiFilledCard(): JSX.Element {
  const query = useAiFilledSummary();

  return (
    <section className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 text-sm font-semibold text-ink">Filled by AI</h3>
        {query.isPending ? (
          <Spinner className="text-ink-3" />
        ) : query.isError ? (
          <span className="text-sm text-bad">Could not load</span>
        ) : (
          <span className="text-sm tabular-nums text-ink">
            <strong>{query.data.questions.toLocaleString()}</strong> live questions
          </span>
        )}
      </div>
      {query.data ? (
        <dl className="m-0 mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-line pt-3 text-xs sm:grid-cols-5">
          {AI_FILLABLE_FIELDS.map((field) => (
            <div key={field} className="flex items-baseline justify-between gap-2 sm:block">
              <dt className="text-ink-3">{FIELD_LABELS[field]}</dt>
              <dd className="m-0 font-semibold tabular-nums text-ink">{query.data.byField[field].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="m-0 mt-3 text-xs text-ink-3">
        These values were approved before reaching the bank. Editing a field removes its AI attribution.
      </p>
    </section>
  );
}
