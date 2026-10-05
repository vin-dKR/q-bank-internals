import { type JSX, type ReactNode, useState } from 'react';
import { ANOMALY_KINDS } from '@ingest/contracts';
import { Button, Card, EmptyState, IconScan, LoadingState } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { useAnomalies, useQualitySummary, useUpdateAnomaly } from '../hooks/use-quality.js';
import { EMPTY_QUALITY_FILTERS, type QualityFilterState } from '../types.js';
import { AiFilledCard } from './ai-filled-card.js';
import { AiWorkspace } from './ai-workspace.js';
import { AnomalyFilters } from './anomaly-filters.js';
import { AnomalyList } from './anomaly-list.js';
import { BulkFixCard } from './bulk-fix-card.js';
import { FixWorkspace } from './fix-workspace.js';
import { GroupBreakdown } from './group-breakdown.js';
import { PlaceBreakdown } from './place-breakdown.js';
import { QualityOverview } from './quality-overview.js';
import { RunScanButton } from './run-scan-button.js';
import { ScanHistory } from './scan-history.js';

export type QualityMode = 'overview' | 'fix' | 'ai';

/** A quiet navigation row; the count appears only where there is work waiting. */
export function ModeSwitch({
  mode,
  onChange,
  questionCount,
  pendingProposals,
  aiRunning,
}: {
  mode: QualityMode;
  onChange: (mode: QualityMode) => void;
  questionCount: number;
  pendingProposals: number;
  aiRunning: boolean;
}): JSX.Element {
  const tabs: { mode: QualityMode; label: string; count?: number }[] = [
    { mode: 'overview', label: 'Overview' },
    { mode: 'fix', label: 'Fix questions', count: questionCount },
    { mode: 'ai', label: 'AI suggestions', count: pendingProposals },
  ];
  return (
    <nav className="flex flex-wrap gap-6 border-b border-line" aria-label="Data quality sections">
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          aria-current={mode === tab.mode ? 'page' : undefined}
          disabled={aiRunning && tab.mode !== mode}
          title={aiRunning && tab.mode !== mode ? 'Stop the AI run before switching sections' : undefined}
          onClick={() => { onChange(tab.mode); }}
          className={cn(
            '-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            mode === tab.mode ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {tab.label}
          {tab.mode === 'ai' && aiRunning ? <span className="text-xs font-normal text-ink-3">Running</span> : null}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-ink-2">
              {tab.count.toLocaleString()}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

/** Keep a secondary view one click away without making the working path a long dashboard. */
function DetailSection({ title, description, children }: { title: string; description: string; children: ReactNode }): JSX.Element {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 marker:hidden focus-visible:ring-2 focus-visible:ring-brand-soft [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <span className="text-xs text-ink-2">{description}</span>
        </span>
        <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-line px-5 py-5">{children}</div>
    </details>
  );
}

/** Broader choices clear their descendants so filters cannot silently contradict one another. */
function applyPatch(prev: QualityFilterState, patch: Partial<QualityFilterState>): QualityFilterState {
  const next = { ...prev, ...patch };
  if (patch.group !== undefined && next.kind !== '' && next.group !== '' && ANOMALY_KINDS[next.kind].group !== next.group) {
    next.kind = '';
  }
  if ('exam' in patch) { next.subject = ''; next.chapter = ''; }
  if ('subject' in patch) next.chapter = '';
  if (patch.kind !== undefined && patch.kind !== '') next.severity = '';
  return next;
}

export function QualityDashboard({
  mode,
  onModeChange,
  fixDirty,
  onFixDirtyChange,
  aiRunning,
  onAiRunningChange,
}: {
  mode: QualityMode;
  onModeChange: (mode: QualityMode) => void;
  fixDirty: boolean;
  onFixDirtyChange: (dirty: boolean) => void;
  aiRunning: boolean;
  onAiRunningChange: (running: boolean) => void;
}): JSX.Element {
  const [listFilters, setListFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const [fixFilters, setFixFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const [aiFilters, setAiFilters] = useState<QualityFilterState>(EMPTY_QUALITY_FILTERS);
  const summary = useQualitySummary();
  const anomalies = useAnomalies(listFilters);
  const review = useUpdateAnomaly();

  if (summary.isPending) return <LoadingState label="Loading data quality…" />;
  if (!summary.data) return <p className="error">Could not load data quality. Check the connection and try again.</p>;
  if (summary.data.lastScan === null) {
    return (
      <EmptyState
        icon={<IconScan />}
        title="Start with a scan"
        body="A scan checks published questions for missing information, damaged content, and duplicates. You can review and fix the results here."
        action={<RunScanButton />}
      />
    );
  }

  const fixGroup = (group: QualityFilterState['group']): void => {
    setFixFilters({ ...EMPTY_QUALITY_FILTERS, group });
    onModeChange('fix');
  };

  const fixQuestion = (questionId: string): void => {
    setFixFilters({ ...EMPTY_QUALITY_FILTERS, q: questionId });
    onModeChange('fix');
  };

  if (mode === 'fix') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2>Work through questions</h2>
          <p className="m-0 mt-1 text-sm text-ink-2">Choose a question, correct its flagged fields, then save. This queue shows open issues only.</p>
        </div>
        <Card className="h-[calc(100dvh-240px)] min-h-[680px] gap-4 p-4 max-[900px]:h-auto max-[900px]:min-h-0">
          <AnomalyFilters
            filters={fixFilters}
            summary={summary.data}
            showStatusTabs={false}
            disabled={fixDirty}
            onChange={(patch) => { setFixFilters((prev) => applyPatch(prev, patch)); }}
            onClear={() => { setFixFilters(EMPTY_QUALITY_FILTERS); }}
          />
          <FixWorkspace
            filters={fixFilters}
            summary={summary.data}
            onDirtyChange={onFixDirtyChange}
          />
        </Card>
        <DetailSection
          title="Automatic fixes across the bank"
          description="Preview rule-based corrections, then apply them to every affected published question. Run a scan afterward."
        >
          <BulkFixCard />
        </DetailSection>
      </div>
    );
  }

  if (mode === 'ai') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2>AI suggestions</h2>
          <p className="m-0 mt-1 text-sm text-ink-2">Generate suggestions for open issues, then approve them individually or in a confirmed high-confidence batch.</p>
        </div>
        <AiWorkspace
          filters={aiFilters}
          summary={summary.data}
          aiRunning={aiRunning}
          onAiRunningChange={onAiRunningChange}
          onChange={(patch) => { setAiFilters((prev) => applyPatch(prev, patch)); }}
          onClear={() => { setAiFilters(EMPTY_QUALITY_FILTERS); }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <QualityOverview summary={summary.data} />
      <Card className="gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>Choose where to start</h2>
            <p className="m-0 mt-1 text-sm text-ink-2">Problem areas are ordered by the number of open issues.</p>
          </div>
          {summary.data.questionsWithOpen > 0 ? (
            <Button onClick={() => { fixGroup(''); }}>Open question queue</Button>
          ) : null}
        </div>
        <GroupBreakdown summary={summary.data} onFixGroup={fixGroup} />
      </Card>
      <div className="flex flex-col gap-2" aria-label="More data quality details">
        <DetailSection title="Browse issue records" description="Inspect individual issues, including ignored and resolved records.">
          <div className="flex flex-col gap-4">
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
              onFixQuestion={fixQuestion}
            />
          </div>
        </DetailSection>
        <DetailSection title="Where issues occur" description="See the subjects and chapters with the most open issues.">
          <PlaceBreakdown summary={summary.data} />
        </DetailSection>
        <DetailSection title="Scan history" description="Review recent scans and how the issue set changed.">
          <ScanHistory />
        </DetailSection>
        <DetailSection title="AI-filled values" description="See which published questions contain approved AI-written values.">
          <AiFilledCard />
        </DetailSection>
      </div>
    </div>
  );
}
