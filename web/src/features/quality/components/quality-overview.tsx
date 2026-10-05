import type { JSX } from 'react';
import type { QualitySummary } from '@ingest/contracts';
import { formatDateTime, severityTotals } from '../lib/anomaly-display.js';

/** Three numbers answer how much work exists; scan context sits below them. */
export function QualityOverview({ summary }: { summary: QualitySummary }): JSX.Element {
  const serious = severityTotals(summary.byKind).high;
  const lastScan = summary.lastScan;
  const metrics = [
    { label: 'Questions needing attention', value: summary.questionsWithOpen, detail: 'Distinct published questions' },
    { label: 'Open issues', value: summary.open, detail: 'A question can have more than one' },
    { label: 'High severity', value: serious, detail: 'Issues that affect what students see' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-3 divide-x divide-line max-[720px]:grid-cols-1 max-[720px]:divide-x-0 max-[720px]:divide-y">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col gap-1 px-5 py-4">
            <span className="text-xs font-medium text-ink-2">{metric.label}</span>
            <span className="text-2xl font-semibold tabular-nums text-ink">{metric.value.toLocaleString()}</span>
            <span className="text-xs text-ink-3">{metric.detail}</span>
          </div>
        ))}
      </div>
      {lastScan ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface-2 px-5 py-2.5 text-xs text-ink-2">
          <span className="font-medium text-ink">
            {lastScan.status === 'running' ? 'Scan in progress' : lastScan.status === 'failed' ? 'Last scan failed' : 'Last scan complete'}
          </span>
          <span>· {formatDateTime(lastScan.startedAt)}</span>
          <span>· {lastScan.questionsScanned.toLocaleString()} questions checked</span>
          {lastScan.status === 'failed' && lastScan.error ? <span className="text-bad">· {lastScan.error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
