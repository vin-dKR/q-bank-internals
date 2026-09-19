import type { QualityScan } from '@ingest/contracts';
import type { QualityScanStore, ScanCounts } from '../../../modules/quality/index.js';

/** In-memory {@link QualityScanStore} (dev). Scan history lives for the process lifetime only. */
export class InMemoryQualityScanStore implements QualityScanStore {
  private readonly scans: QualityScan[] = [];

  latest(): Promise<QualityScan | null> {
    return Promise.resolve(this.scans[0] ?? null);
  }

  list(limit: number): Promise<QualityScan[]> {
    return Promise.resolve(this.scans.slice(0, limit));
  }

  start(startedAt: Date): Promise<QualityScan> {
    const scan: QualityScan = {
      id: String(this.scans.length + 1),
      status: 'running',
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      questionsScanned: 0,
      anomaliesFound: 0,
      opened: 0,
      reopened: 0,
      resolved: 0,
      removed: 0,
      error: null,
    };
    this.scans.unshift(scan);
    return Promise.resolve(scan);
  }

  complete(id: string, counts: ScanCounts, finishedAt: Date): Promise<QualityScan> {
    return Promise.resolve(this.patch(id, { ...counts, status: 'completed', finishedAt: finishedAt.toISOString() }));
  }

  fail(id: string, error: string, finishedAt: Date): Promise<void> {
    this.patch(id, { status: 'failed', error, finishedAt: finishedAt.toISOString() });
    return Promise.resolve();
  }

  private patch(id: string, changes: Partial<QualityScan>): QualityScan {
    const index = this.scans.findIndex((scan) => scan.id === id);
    const current = this.scans[index];
    if (!current) throw new Error(`Unknown scan "${id}".`);
    const updated = { ...current, ...changes };
    this.scans[index] = updated;
    return updated;
  }
}
