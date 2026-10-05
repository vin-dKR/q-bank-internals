import { type JSX, useCallback, useEffect, useState } from 'react';
import type { QualitySummary } from '@ingest/contracts';
import { useConfirm } from '../../../shared/ui/index.js';
import {
  useAiFix,
  useApplyFix,
  useFixQueue,
  useFixTarget,
  useUpdateAnomaly,
} from '../hooks/use-quality.js';
import type { QualityFilterState } from '../types.js';
import { FixPanel } from './fix-panel.js';
import { FixQueue } from './fix-queue.js';

/** A question list and an editor sharing the available height on wide screens. */
export function FixWorkspace({
  filters,
  summary,
  onDirtyChange,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
  /** The page uses this to guard changes to its filters or current view. */
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const queue = useFixQueue(filters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const [confirm, confirmDialog] = useConfirm();
  const target = useFixTarget(selectedId);
  const applyFix = useApplyFix();
  const aiFix = useAiFix();
  const review = useUpdateAnomaly();

  const items = queue.data?.pages.flatMap((page) => page.items) ?? [];
  const handleDirtyChange = useCallback((next: boolean): void => {
    setDirty(next);
    onDirtyChange?.(next);
  }, [onDirtyChange]);

  // A refetch may change the queue while someone is editing. Keep that draft visible until they save or
  // explicitly discard it, even if its row has left the current filtered list.
  useEffect(() => {
    if (!queue.data || dirty) return;
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId === null || !items.some((item) => item.questionId === selectedId)) {
      setSelectedId(items[0]?.questionId ?? null);
    }
  }, [queue.data, items, selectedId, dirty]);

  const selectQuestion = async (questionId: string, afterSave = false): Promise<void> => {
    if (questionId === selectedId || (applyFix.isPending && !afterSave)) return;
    if (dirty && !afterSave) {
      const confirmed = await confirm({
        title: 'Discard unsaved changes?',
        body: 'Your edits to this question have not been saved.',
        confirmLabel: 'Discard and continue',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    setSelectedId(questionId);
  };

  const goNext = (afterSave = false): void => {
    const index = items.findIndex((item) => item.questionId === selectedId);
    const next = items[index + 1] ?? items[0];
    if (next) void selectQuestion(next.questionId, afterSave);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-4 max-[900px]:flex max-[900px]:flex-col max-[900px]:overflow-y-auto">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface max-[900px]:max-h-72 max-[900px]:flex-none" aria-label="Questions to review">
        <div className="flex flex-none items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="m-0 text-sm font-semibold text-ink">Questions to review</h2>
          <span className="text-xs tabular-nums text-ink-3">{(queue.data?.pages[0]?.total ?? 0).toLocaleString()}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FixQueue
            query={queue}
            selectedId={selectedId}
            disabled={applyFix.isPending}
            onSelect={(questionId) => { void selectQuestion(questionId); }}
          />
        </div>
      </section>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface max-[900px]:min-h-[640px] max-[900px]:flex-none">
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
          saveRevision={saveRevision}
          onDirtyChange={handleDirtyChange}
          onSave={(fix, andNext, ai) => {
            if (selectedId === null) return;
            applyFix.mutate({ questionId: selectedId, fix, ai }, {
              onSuccess: () => {
                setSaveRevision((revision) => revision + 1);
                if (andNext) goNext(true);
              },
            });
          }}
          onAiFix={(fields, respectType) => aiFix.mutateAsync({ questionId: selectedId ?? '', fields, respectType: respectType ?? false })}
          onIgnore={(anomalyId) => { review.mutate({ id: anomalyId, update: { status: 'ignored' } }); }}
          onNext={() => { goNext(); }}
        />
      </div>
      {confirmDialog}
    </div>
  );
}
