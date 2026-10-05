import type { JSX } from 'react';
import type { QualityScan } from '@ingest/contracts';
import { LoadingState } from '../../../shared/ui/index.js';
import { useQualityScans } from '../hooks/use-quality.js';
import { formatDateTime } from '../lib/anomaly-display.js';

function duration(scan: QualityScan): string {
  if (scan.finishedAt === null) return 'Still running';
  const seconds = (new Date(scan.finishedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000;
  return `${seconds.toFixed(1)}s`;
}

function ScanRow({ scan }: { scan: QualityScan }): JSX.Element {
  const changes = [
    { label: 'New', value: scan.opened },
    { label: 'Reopened', value: scan.reopened },
    { label: 'Resolved', value: scan.resolved },
    { label: 'Removed', value: scan.removed },
  ];
  return (
    <li>
      <details className="group rounded-lg border border-line bg-surface">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">{formatDateTime(scan.startedAt)}</span>
          <span className={scan.status === 'failed' ? 'text-xs font-medium capitalize text-bad' : 'text-xs font-medium capitalize text-ink-2'}>
            {scan.status}
          </span>
          <span className="min-w-28 text-right text-xs tabular-nums text-ink-3">
            {scan.questionsScanned.toLocaleString()} questions
          </span>
          <span aria-hidden="true" className="text-xs text-ink-3 transition-transform group-open:rotate-90">▶</span>
        </summary>
        <div className="border-t border-line px-3 py-3">
          {scan.error ? <p className="m-0 mb-3 text-sm text-bad">{scan.error}</p> : null}
          <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
            <div><dt className="text-ink-3">Duration</dt><dd className="m-0 font-medium tabular-nums text-ink">{duration(scan)}</dd></div>
            <div><dt className="text-ink-3">Issues found</dt><dd className="m-0 font-medium tabular-nums text-ink">{scan.anomaliesFound.toLocaleString()}</dd></div>
            {changes.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-ink-3">{label}</dt>
                <dd className="m-0 font-medium tabular-nums text-ink">{value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          {scan.removed > 0 ? <p className="m-0 mt-3 text-xs text-ink-3">Removed issues belonged to questions that left the live bank.</p> : null}
        </div>
      </details>
    </li>
  );
}

/** Recent scan runs, with detailed changes available from each row. */
export function ScanHistory(): JSX.Element {
  const scans = useQualityScans();
  if (scans.isPending) return <LoadingState label="Loading scan history…" />;
  if (scans.isError) return <p className="error">Could not load scan history.</p>;
  if (scans.data.scans.length === 0) return <p className="muted">No scans yet.</p>;

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {scans.data.scans.map((scan) => <ScanRow key={scan.id} scan={scan} />)}
    </ul>
  );
}
