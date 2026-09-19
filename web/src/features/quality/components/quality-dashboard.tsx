import { type JSX, useState } from 'react';
import { ANOMALY_KINDS } from '@ingest/contracts';
import { Card, EmptyState, IconEdit, IconGrid, IconScan, IconSparkle, LoadingState } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { useAnomalies, useQualitySummary, useUpdateAnomaly } from '../hooks/use-quality.js';
import { EMPTY_QUALITY_FILTERS, type QualityFilterState } from '../types.js';
import { AiFilledCard } from './ai-filled-card.js';
import { AiWorkspace } from './ai-workspace.js';
import { AnomalyFilters } from './anomaly-filters.js';
import { AnomalyList } from './anomaly-list.js';
import { BulkFixCard } from './bulk-fix-card.js';
import { FixAllButton } from './fix-all-button.js';
import { FixWorkspace } from './fix-workspace.js';
import { GroupBreakdown } from './group-breakdown.js';
import { PlaceBreakdown } from './place-breakdown.js';
import { QualityOverview } from './quality-overview.js';
import { RunScanButton } from './run-scan-button.js';
import { ScanHistory } from './scan-history.js';

/**
 * The page has two modes over the same tracked set: the dashboard answers "how bad is it, and where", the
 * fix workspace is where the corrections are actually made. One switcher at the top chooses between them so
 * neither half buries the other.
 */
export type QualityMode = 'dashboard' | 'fix' | 'ai';

/**
 * Apply a filter change, keeping the selection coherent: a rule that no longer belongs to the picked group
 * is dropped, and a broader taxonomy choice clears the narrower ones it scopes — so you can never hold a
 * chapter from a different subject, or a subject from a different exam.
 */
function applyPatch(prev: QualityFilterState, patch: Partial<QualityFilterState>): QualityFilterState {
  const next = { ...prev, ...patch };
  if (patch.group !== undefined && next.kind !== '' && next.group !== '' && ANOMALY_KINDS[next.kind].group !== next.group) {
    next.kind = '';
  }
  if ('exam' in patch) { next.subject = ''; next.chapter = ''; }
  if ('subject' in patch) { next.chapter = ''; }
  // A rule fixes its own severity; a leftover severity choice could only contradict it and match nothing.
  if (patch.kind !== undefined && patch.kind !== '') next.severity = '';
  return next;
}

/**
 * The mode switcher: two segmented buttons, each with its live count. Lives in the page header so the
 * working screen starts as high as possible.
 */
export function ModeSwitch({
  mode,
  onChange,
  openCount,
  questionCount,
  pendingProposals,
}: {
  mode: QualityMode;
  onChange: (mode: QualityMode) => void;
  openCount: number;
  questionCount: number;
  /** AI proposals waiting for a decision — the reason to visit the third tab. */
  pendingProposals: number;
}): JSX.Element {
  const tabs: { mode: QualityMode; label: string; count: number; icon: JSX.Element }[] = [
    { mode: 'dashboard', label: 'Dashboard', count: openCount, icon: <IconGrid /> },
    { mode: 'fix', label: 'Fix questions', count: questionCount, icon: <IconEdit /> },
    { mode: 'ai', label: 'Fix with AI', count: pendingProposals, icon: <IconSparkle /> },
  ];
  return (
    <div className="flex w-fit items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          aria-pressed={mode === tab.mode}
          onClick={() => { onChange(tab.mode); }}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors [&>svg]:size-4',
            mode === tab.mode ? 'bg-brand text-white shadow-sm' : 'text-ink-2 hover:bg-surface hover:text-ink',
          )}
        >
          {tab.icon}
          {tab.label}
          <span
            className={cn(
              'rounded-full px-1.5 py-px text-[11px] tabular-nums',
              mode === tab.mode ? 'bg-white/20 text-white' : 'bg-surface text-ink-3',
            )}
          >
            {tab.count.toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Data quality over the live shared bank. `dashboard` shows where the problems are (totals, groups, the
 * full problem list, scan history); `fix` is the working mode (automatic fixes, then the queue + editor).
 * Both read the same filters, so narrowing in one mode carries into the other.
 */
export function QualityDashboard({ mode, onModeChange }: { mode: QualityMode; onModeChange: (mode: QualityMode) => void }): JSX.Element {
  // Each mode keeps its OWN filters: narrowing the dashboard's problem list is a way of reading the data,
  // and must never silently change what the fix workspace offers (or vice versa).
  const [listFilters, setListFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const [fixFilters, setFixFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const [aiFilters, setAiFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const summary = useQualitySummary();
  const anomalies = useAnomalies(listFilters);
  const review = useUpdateAnomaly();

  if (summary.isPending) return <LoadingState label="Loading data quality…" />;
  if (summary.isError) return <p className="error">Could not reach the API. Is it running on :4000?</p>;

  if (summary.data.lastScan === null) {
    return (
      <EmptyState
        icon={<IconScan />}
        title="No scan has run yet"
        body="A scan checks every question live on Eduents (the shared bank every organisation sees) for missing answers, topics and metadata, broken LaTeX, missing images, and duplicates, and keeps tracking them from then on. Ingest sessions and unpublished questions are not scanned."
        action={<RunScanButton />}
      />
    );
  }

  /** Open the fix workspace already narrowed to one group — the dashboard's only action. */
  const fixGroup = (group: QualityFilterState['group']): void => {
    setFixFilters({ ...EMPTY_QUALITY_FILTERS, group });
    onModeChange('fix');
  };

  return (
    <div className={cn('flex flex-col gap-4', mode === 'fix' && 'min-h-0 flex-1')}>
      {mode === 'dashboard' ? (
        <>
          <QualityOverview summary={summary.data} />
          <AiFilledCard />
          <GroupBreakdown summary={summary.data} onFixGroup={fixGroup} />
          <PlaceBreakdown summary={summary.data} />

          <Card>
            <div className="card__title">Browse every problem</div>
            <AnomalyFilters
              filters={listFilters}
              summary={summary.data}
              onChange={(patch) => { setListFilters((prev) => applyPatch(prev, patch)); }}
              onClear={() => { setListFilters((prev) => ({ ...EMPTY_QUALITY_FILTERS, status: prev.status })); }}
            />
            <AnomalyList
              query={anomalies}
              onReview={(id, status) => { review.mutate({ id, update: { status } }); }}
              pendingId={review.isPending ? review.variables.id : null}
            />
          </Card>

          <Card>
            <div className="card__title">Fix automatically — no typing needed</div>
            <BulkFixCard />
          </Card>

          <Card>
            <div className="card__title">Scan history</div>
            <ScanHistory />
          </Card>
        </>
      ) : mode === 'ai' ? (
        // Bulk AI: narrow with the same filters, run over everything that matches, review what comes back.
        <Card className="gap-3">
          <AiWorkspace
            filters={aiFilters}
            summary={summary.data}
            onChange={(patch) => { setAiFilters((prev) => applyPatch(prev, patch)); }}
            onClear={() => { setAiFilters((prev) => ({ ...EMPTY_QUALITY_FILTERS, status: prev.status })); }}
          />
        </Card>
      ) : (
        // The working screen: filters on one line, then the workspace filling the rest of the viewport, so
        // a question is read and corrected without the page scrolling.
        <Card className="min-h-0 flex-1 gap-3">
          <AnomalyFilters
            filters={fixFilters}
            summary={summary.data}
            showRulePicker={false}
            actions={<FixAllButton kind={fixFilters.kind} group={fixFilters.group} />}
            onChange={(patch) => { setFixFilters((prev) => applyPatch(prev, patch)); }}
            onClear={() => { setFixFilters((prev) => ({ ...EMPTY_QUALITY_FILTERS, status: prev.status })); }}
          />
          <FixWorkspace
            filters={fixFilters}
            summary={summary.data}
            onFilterChange={(patch) => { setFixFilters((prev) => applyPatch(prev, patch)); }}
          />
        </Card>
      )}
    </div>
  );
}
