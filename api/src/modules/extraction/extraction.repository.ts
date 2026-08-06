import type { ExtractionJob } from '@ingest/contracts';

/** Fields the worker updates on a job as it moves queued → running → succeeded/failed. */
export type ExtractionJobPatch = Partial<
  Pick<ExtractionJob, 'status' | 'questionsFound' | 'error' | 'startedAt' | 'finishedAt'>
>;

/** Persistence port for extraction jobs (§3). Implemented in-memory (dev) or Prisma (prod). */
export interface ExtractionJobStore {
  create(input: { documentId: string; model: string }): Promise<ExtractionJob>;
  findById(id: string): Promise<ExtractionJob | null>;
  update(id: string, patch: ExtractionJobPatch): Promise<ExtractionJob>;
  /** Remove all jobs for a document — required before the document itself can be deleted. */
  deleteByDocument(documentId: string): Promise<void>;
}
