import type { ExtractionJob } from '@ingest/contracts';

/** Persistence port for extraction jobs (§3). Implemented in-memory (dev) or Prisma (prod). */
export interface ExtractionJobStore {
  create(input: { documentId: string; model: string }): Promise<ExtractionJob>;
  findById(id: string): Promise<ExtractionJob | null>;
}
