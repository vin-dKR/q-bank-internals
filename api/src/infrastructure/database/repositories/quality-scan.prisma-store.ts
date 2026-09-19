import type { PrismaClient, QualityScan as ScanRow } from '@prisma/client';
import { QualityScanSchema, type QualityScan } from '@ingest/contracts';
import type { QualityScanStore, ScanCounts } from '../../../modules/quality/index.js';

function toScan(row: ScanRow): QualityScan {
  return QualityScanSchema.parse({
    ...row,
    removed: row.removed ?? 0,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  });
}

/** Prisma/Mongo {@link QualityScanStore} over `ingest_quality_scans`. */
export class PrismaQualityScanStore implements QualityScanStore {
  constructor(private readonly prisma: PrismaClient) {}

  async latest(): Promise<QualityScan | null> {
    const row = await this.prisma.qualityScan.findFirst({ orderBy: { startedAt: 'desc' } });
    return row ? toScan(row) : null;
  }

  async list(limit: number): Promise<QualityScan[]> {
    const rows = await this.prisma.qualityScan.findMany({ orderBy: { startedAt: 'desc' }, take: limit });
    return rows.map(toScan);
  }

  async start(startedAt: Date): Promise<QualityScan> {
    return toScan(await this.prisma.qualityScan.create({ data: { status: 'running', startedAt } }));
  }

  async complete(id: string, counts: ScanCounts, finishedAt: Date): Promise<QualityScan> {
    return toScan(
      await this.prisma.qualityScan.update({ where: { id }, data: { ...counts, status: 'completed', finishedAt } }),
    );
  }

  async fail(id: string, error: string, finishedAt: Date): Promise<void> {
    await this.prisma.qualityScan.update({ where: { id }, data: { status: 'failed', error, finishedAt } });
  }
}
