import type { JSX } from 'react';
import type { QualitySummary } from '@ingest/contracts';
import { formatDateTime, severityTotals } from '../lib/anomaly-display.js';

type Tile = { label: string; value: number; hint: string; accent: string };

/** Headline tiles: what is open, how many questions it touches, and what was ignored or fixed. */
export function QualityOverview({ summary }: { summary: QualitySummary }): JSX.Element {
  const { lastScan } = summary;
  const scanned = lastScan?.questionsScanned ?? 0;
  const severity = severityTotals(summary.byKind);
  const affectedShare = scanned === 0 ? 0 : Math.round((summary.questionsWithOpen / scanned) * 100);
  const tiles: Tile[] = [
    { label: 'Open problems', value: summary.open, hint: `${String(severity.high)} serious · ${String(severity.medium)} medium · ${String(severity.low)} cosmetic`, accent: 'text-bad' },
    {
      label: 'Questions affected',
      value: summary.questionsWithOpen,
      hint: scanned === 0 ? 'With at least one open problem' : `${String(affectedShare)}% of the ${scanned.toLocaleString()} live questions`,
      accent: 'text-ink',
    },
    { label: 'Clean questions', value: Math.max(0, scanned - summary.questionsWithOpen), hint: 'Nothing open against them', accent: 'text-ok' },
    { label: 'Reviewed', value: summary.ignored + summary.resolved, hint: `${summary.ignored.toLocaleString()} ignored · ${summary.resolved.toLocaleString()} resolved`, accent: 'text-ink-2' },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-3">{tile.label}</span>
            <span className={`text-2xl font-semibold tabular-nums ${tile.accent}`}>{tile.value.toLocaleString()}</span>
            <span className="text-xs text-ink-3">{tile.hint}</span>
          </div>
        ))}
      </div>
      <p className="m-0 text-xs text-ink-3">
        {lastScan === null
          ? 'No scan has run yet.'
          : lastScan.status === 'failed'
            ? `Last scan failed ${formatDateTime(lastScan.startedAt)}: ${lastScan.error ?? 'unknown error'}`
            : lastScan.status === 'running'
              ? `A scan started ${formatDateTime(lastScan.startedAt)} is still running.`
              : `Last scan ${formatDateTime(lastScan.startedAt)} · ${lastScan.questionsScanned.toLocaleString()} live questions checked`}
      </p>
    </div>
  );
}
