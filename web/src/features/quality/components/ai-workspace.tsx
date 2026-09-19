import type { JSX } from 'react';
import { ANOMALY_KINDS, type QualitySummary } from '@ingest/contracts';
import { useQualityFilterOptions } from '../hooks/use-quality.js';
import type { QualityFilterState } from '../types.js';
import { AiRunBar } from './ai-run-bar.js';
import { AnomalyFilters } from './anomaly-filters.js';
import { ProposalReview } from './proposal-review.js';

/**
 * Bulk AI: narrow with the same filters used everywhere, run over everything that matches, review what
 * comes back. The counts here drive both the run button and which fields are proposed, so what the screen
 * offers always matches what this selection is actually missing.
 */
export function AiWorkspace({
  filters,
  summary,
  onChange,
  onClear,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
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

  // Counts come back per rule for the current exam/subject/chapter/severity/search. A chosen rule narrows
  // to that rule; a chosen group sums its rules; otherwise it is everything the filters leave.
  const counts = options.data?.byKind ?? [];
  const matching = counts
    .filter((row) => filters.kind === '' || row.kind === filters.kind)
    .filter((row) => filters.group === '' || ANOMALY_KINDS[row.kind].group === filters.group)
    .reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <AnomalyFilters filters={filters} summary={summary} onChange={onChange} onClear={onClear} />
      <AiRunBar filters={filters} counts={counts} matching={matching} loading={options.isPending} />
      <ProposalReview />
    </>
  );
}
