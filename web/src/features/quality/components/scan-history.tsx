import type { JSX } from 'react';
import type { QualityScan } from '@ingest/contracts';
import { Badge, type BadgeTone, LoadingState } from '../../../shared/ui/index.js';
import { useQualityScans } from '../hooks/use-quality.js';
import { formatDateTime } from '../lib/anomaly-display.js';

const STATUS_TONE: Record<QualityScan['status'], BadgeTone> = {
  running: 'progress',
  completed: 'success',
  failed: 'danger',
};

function duration(scan: QualityScan): string {
  if (scan.finishedAt === null) return '—';
  const seconds = (new Date(scan.finishedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000;
  return `${seconds.toFixed(1)}s`;
}

/** Recent scan runs: when each ran, how many live questions it checked, and how it moved the tracked set. */
export function ScanHistory(): JSX.Element {
  const scans = useQualityScans();
  if (scans.isPending) return <LoadingState label="Loading scan history…" />;
  if (scans.isError) return <p className="error">Could not load scan history.</p>;
  if (scans.data.scans.length === 0) return <p className="muted">No scans yet.</p>;

  return (
    <div className="table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            <th>Started</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Questions</th>
            <th>Anomalies</th>
            <th>New</th>
            <th>Reopened</th>
            <th>Resolved</th>
            <th title="Anomalies dropped because their question was deleted or left the live bank">Removed</th>
          </tr>
        </thead>
        <tbody>
          {scans.data.scans.map((scan) => (
            <tr key={scan.id} title={scan.error ?? undefined}>
              <td>{formatDateTime(scan.startedAt)}</td>
              <td><Badge tone={STATUS_TONE[scan.status]}>{scan.status}</Badge></td>
              <td className="num">{duration(scan)}</td>
              <td className="num">{scan.questionsScanned.toLocaleString()}</td>
              <td className="num">{scan.anomaliesFound.toLocaleString()}</td>
              <td className="num">{scan.opened.toLocaleString()}</td>
              <td className="num">{scan.reopened.toLocaleString()}</td>
              <td className="num">{scan.resolved.toLocaleString()}</td>
              <td className="num">{scan.removed.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
