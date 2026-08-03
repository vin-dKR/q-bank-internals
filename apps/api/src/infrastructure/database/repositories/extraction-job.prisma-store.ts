import type { PrismaClient } from '@prisma/client';
import type { ExtractionJob } from '@ingest/contracts';
import type { ExtractionJobPatch, ExtractionJobStore } from '../../../modules/extraction/index.js';

type JobRow = {
  id: string;
  documentId: string;
  status: string;
  model: string;
  questionsFound: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function toJob(row: JobRow): ExtractionJob {
  return {
    id: row.id,
    documentId: row.documentId,
    status: row.status as ExtractionJob['status'],
    model: row.model,
    questionsFound: row.questionsFound,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** Production adapter for {@link ExtractionJobStore}, backed by MongoDB via Prisma. */
export class PrismaExtractionJobStore implements ExtractionJobStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { documentId: string; model: string }): Promise<ExtractionJob> {
    const row = await this.prisma.extractionJob.create({
      data: { documentId: input.documentId, model: input.model },
    });
    return toJob(row);
  }

  async findById(id: string): Promise<ExtractionJob | null> {
    const row = await this.prisma.extractionJob.findUnique({ where: { id } });
    return row ? toJob(row) : null;
  }

  async update(id: string, patch: ExtractionJobPatch): Promise<ExtractionJob> {
    const row = await this.prisma.extractionJob.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.questionsFound !== undefined ? { questionsFound: patch.questionsFound } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.startedAt !== undefined
          ? { startedAt: patch.startedAt === null ? null : new Date(patch.startedAt) }
          : {}),
        ...(patch.finishedAt !== undefined
          ? { finishedAt: patch.finishedAt === null ? null : new Date(patch.finishedAt) }
          : {}),
      },
    });
    return toJob(row);
  }
}
