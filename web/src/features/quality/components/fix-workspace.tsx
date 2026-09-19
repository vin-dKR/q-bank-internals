import { type JSX, useEffect, useState } from 'react';
import { ANOMALY_KINDS, type QualitySummary } from '@ingest/contracts';
import {
  useAiFix,
  useApplyFix,
  useFixQueue,
  useFixTarget,
  useQualityFilterOptions,
  useUpdateAnomaly,
} from '../hooks/use-quality.js';
import type { QualityFilterState } from '../types.js';
import { FixPanel } from './fix-panel.js';
import { FixQueue } from './fix-queue.js';
import { IssueTree } from './issue-tree.js';

/**
 * The fixing half of the page, in three columns: the problem tree (what am I working on), the editor in the
 * middle where the work happens, and the queue of affected questions down the right. The first question is
 * selected automatically, and "Save & next" walks the queue without touching the mouse.
 */
export function FixWorkspace({
  filters,
  summary,
  onFilterChange,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
  onFilterChange: (patch: Partial<QualityFilterState>) => void;
}): JSX.Element {
  const queue = useFixQueue(filters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const target = useFixTarget(selectedId);
  const applyFix = useApplyFix();
  const aiFix = useAiFix();
  const review = useUpdateAnomaly();

  // The tree's numbers follow the filters (exam, subject, chapter, severity, search); until they arrive,
  // the summary's unfiltered counts stand in so the tree is never blank.
  const options = useQualityFilterOptions({
    status: filters.status,
    group: filters.group,
    kind: filters.kind,
    severity: filters.severity,
    exam: filters.exam,
    subject: filters.subject,
    chapter: filters.chapter,
  });
  const counts =
    options.data?.byKind ?? summary.byKind.map((row) => ({ kind: row.kind, count: row[filters.status] }));

  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  // Keep the selection in step with the queue: pick the first row initially, and once the selected question
  // drops out of the list (fixed, or filtered away) move to whatever now sits in its place.
  useEffect(() => {
    if (items.length === 0) { setSelectedId(null); return; }
    if (selectedId === null || !items.some((item) => item.questionId === selectedId)) {
      setSelectedId(items[0]?.questionId ?? null);
    }
  }, [items, selectedId]);

  const goNext = (): void => {
    const index = items.findIndex((item) => item.questionId === selectedId);
    const next = items[index + 1] ?? items[0];
    if (next) setSelectedId(next.questionId);
  };

  const heading = filters.kind !== '' ? ANOMALY_KINDS[filters.kind].label : 'Questions to fix';

  return (
    // Fills whatever the page has left, so the window itself never scrolls: each column scrolls on its own,
    // and the editor's Save row stays pinned in view.
    <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_320px] gap-4 max-[1400px]:grid-cols-[240px_minmax(0,1fr)] max-[1400px]:grid-rows-[minmax(0,1fr)_auto] max-[900px]:h-auto max-[900px]:grid-cols-1">
      <div className="h-full overflow-y-auto pr-1 max-[900px]:h-auto max-[900px]:max-h-64">
        <IssueTree
          counts={counts}
          group={filters.group}
          kind={filters.kind}
          onSelect={({ group, kind }) => { onFilterChange({ group, kind }); }}
        />
      </div>

      {/* No scrolling here: the panel scrolls its own body and keeps the Save row pinned below it. */}
      <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface max-[900px]:h-[70vh]">
        <FixPanel
          questionId={selectedId}
          target={target.data}
          ruleKind={filters.kind}
          ruleGroup={filters.group}
          isPending={target.isPending && selectedId !== null}
          isError={target.isError}
          summary={summary}
          saving={applyFix.isPending}
          aiBusy={aiFix.isPending}
          onSave={(fix, andNext, ai) => {
            if (selectedId === null) return;
            applyFix.mutate({ questionId: selectedId, fix, ai }, { onSuccess: () => { if (andNext) goNext(); } });
          }}
          onAiFix={(fields, respectType) => aiFix.mutateAsync({ questionId: selectedId ?? '', fields, respectType: respectType ?? false })}
          onIgnore={(anomalyId) => { review.mutate({ id: anomalyId, update: { status: 'ignored' } }); }}
          onNext={goNext}
        />
      </div>

      {/* Last column on a wide screen, and a short list under the editor once the screen cannot hold three. */}
      <div className="flex h-full min-h-0 flex-col gap-2 max-[1400px]:col-span-2 max-[1400px]:h-auto max-[900px]:col-span-1">
        <div className="flex flex-none flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">{heading}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 max-[1400px]:max-h-64 max-[900px]:max-h-80">
          <FixQueue query={queue} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </div>
  );
}
