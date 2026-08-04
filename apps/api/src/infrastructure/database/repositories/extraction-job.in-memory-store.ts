import { randomUUID } from 'node:crypto';
import type { ExtractionJob } from '@ingest/contracts';
import type { ExtractionJobPatch, ExtractionJobStore } from '../../../modules/extraction/index.js';

/** Dev/test adapter for {@link ExtractionJobStore}. Jobs live in memory until the worker exists. */
export class InMemoryExtractionJobStore implements ExtractionJobStore {
  private readonly store = new Map<string, ExtractionJob>();

  create(input: { documentId: string; model: string }): Promise<ExtractionJob> {
    const job: ExtractionJob = {
      id: randomUUID(),
      documentId: input.documentId,
      status: 'queued',
      model: input.model,
      questionsFound: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    this.store.set(job.id, job);
    return Promise.resolve(job);
  }

  findById(id: string): Promise<ExtractionJob | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  update(id: string, patch: ExtractionJobPatch): Promise<ExtractionJob> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Extraction job ${id} vanished from the in-memory store.`);
    const updated: ExtractionJob = { ...existing, ...patch };
    this.store.set(id, updated);
    return Promise.resolve(updated);
  }

  deleteByDocument(documentId: string): Promise<void> {
    for (const [id, job] of this.store) {
      if (job.documentId === documentId) this.store.delete(id);
    }
    return Promise.resolve();
  }
}
