import type { JSX } from 'react';
import { type QualitySummary } from '@ingest/contracts';
import { useFixQueue, useQualityFilterOptions } from '../hooks/use-quality.js';
import type { QualityFilterState } from '../types.js';
import { AiRunBar } from './ai-run-bar.js';
import { AnomalyFilters } from './anomaly-filters.js';
import { ProposalReview } from './proposal-review.js';

/**
 * Bulk AI: choose questions, generate suggestions, then review them before anything is saved. Rule counts
 * can suggest fields, but the queue supplies the run's distinct-question total under every filter, including
 * the text search.
 */
export function AiWorkspace({
  filters,
  summary,
  aiRunning,
  onAiRunningChange,
  onChange,
  onClear,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
  aiRunning: boolean;
  onAiRunningChange: (running: boolean) => void;
  onChange: (patch: Partial<QualityFilterState>) => void;
  onClear: () => void;
}): JSX.Element {
  const options = useQualityFilterOptions({
    status: filters.status,
    group: filters.group,
    kind: filters.kind,
    severity: filters.severity,
    exam: filters.exam,
    subject: filters.subject,
    chapter: filters.chapter,
  });
  const queue = useFixQueue(filters);

  // These rule counts suggest which fields to ask for. They do not include the text search, so they must
  // never be presented as the number of questions in the run.
  const counts = options.data?.byKind ?? [];
  const matching = queue.data?.pages[0]?.total ?? 0;

  return (
    <>
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold text-ink">1. Choose questions</h2>
          <p className="m-0 mt-1 text-xs text-ink-3">
            Filter the questions you want the AI to examine.
          </p>
        </div>
        <AnomalyFilters
          filters={filters}
          summary={summary}
          showStatusTabs={false}
          disabled={aiRunning}
          disabledMessage="Stop the AI run before changing filters."
          onChange={onChange}
          onClear={onClear}
        />
      </section>
      <AiRunBar
        filters={filters}
        counts={counts}
        matching={matching}
        loading={queue.isPending || options.isPending}
        countError={queue.isError}
        onRunningChange={onAiRunningChange}
      />
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold text-ink">3. Review suggestions</h2>
          <p className="m-0 mt-1 text-xs text-ink-3">
            Open a suggestion to compare it with the question, then apply or discard it.
          </p>
        </div>
        <ProposalReview runInProgress={aiRunning} />
      </section>
    </>
  );
}
