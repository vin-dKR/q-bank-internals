import type { Document, ExtractionJob } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { UsageService } from '../usage/index.js';
import type { ExtractionJobStore } from './extraction.repository.js';
import type { ExtractionRunRegistry } from './extraction-run-registry.js';
import type { JobQueue } from './job-queue.js';

/**
 * Owns the "hand a document to the extractor" decision. It verifies the document, enforces the token
 * budget, records a job, marks the document queued, and pushes the work onto the {@link JobQueue}.
 * The heavy vision work runs in the worker that drains the queue — the API stays fast and never
 * blocks on the model.
 */
export class ExtractionService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly jobs: ExtractionJobStore,
    private readonly queue: JobQueue,
    private readonly usage: UsageService,
    private readonly model: string,
    private readonly runs: ExtractionRunRegistry,
  ) {}

  /** Queue extraction for one document. Idempotent-ish: refuses a document already extracting. */
  async enqueue(documentId: string): Promise<ExtractionJob> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.status === 'extracting') throw errors.extractionInProgress(documentId);
    await this.usage.assertWithinLimit();

    await this.documents.updateStatus(documentId, 'queued');
    const job = await this.jobs.create({ documentId, model: this.model });
    await this.queue.enqueue({ jobId: job.id, documentId });
    return job;
  }

  /**
   * Re-run a question document using the prompts currently saved in Prompt Studio.
   * The worker's document-level replace is intentional: a fresh extraction must
   * not leave stale questions, crops, or comprehension groups beside the new set.
   */
  async reextract(documentId: string): Promise<ExtractionJob> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.kind !== 'question' || document.status === 'published') {
      throw errors.documentNotReextractable(documentId, document.status);
    }
    if (document.status === 'extracting' || document.status === 'queued') {
      throw errors.extractionInProgress(documentId);
    }
    return this.enqueue(documentId);
  }

  /**
   * Queue extraction for every not-yet-extracted question document in a session — the "run the whole
   * batch" action. Answer/solution PDFs are pulled in automatically by their question sibling, and
   * already-extracted files are skipped, so this never re-does completed work.
   */
  async enqueueSession(sessionId: string): Promise<{ enqueued: number; jobIds: string[] }> {
    const documents = await this.documents.listBySession(sessionId);
    const targets = documents.filter(
      (document) =>
        document.kind === 'question' &&
        (document.status === 'uploaded' || document.status === 'failed'),
    );
    const jobIds: string[] = [];
    for (const document of targets) {
      const job = await this.enqueue(document.id);
      jobIds.push(job.id);
    }
    return { enqueued: targets.length, jobIds };
  }

  async getJob(id: string): Promise<ExtractionJob> {
    const job = await this.jobs.findById(id);
    if (!job) throw errors.extractionJobNotFound(id);
    return job;
  }

  /**
   * The latest extraction job for a document, or null if it has never been extracted. This is what
   * drives the shared progress bar: any operator viewing the file — not just the tab that started the
   * run — polls by document id and sees the same live counts written to the job row, which is also the
   * only way the bar can appear on serverless (where the enqueue request blocks until the run is over).
   */
  async latestJobForDocument(documentId: string): Promise<ExtractionJob | null> {
    return this.jobs.findLatestByDocument(documentId);
  }

  /**
   * Cancel an in-flight extraction: signal the run's AbortController (stops the vision call in this
   * process), drop the still-queued entry from the queue, mark the job `cancelled`, and return the
   * document to a re-runnable `failed` state. A no-op on an already-finished job (idempotent).
   */
  async cancel(jobId: string): Promise<ExtractionJob> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw errors.extractionJobNotFound(jobId);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    this.runs.abort(jobId, 'cancelled');
    await this.queue.cancel(jobId);
    const cancelled = await this.jobs.update(jobId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
    });
    await this.documents.updateStatus(job.documentId, 'failed');
    return cancelled;
  }

  /**
   * Pause after the current durable page checkpoint. A callback already reading a page cannot be
   * interrupted across serverless instances, but it saves that paid-for response and never queues
   * the following page. Resume therefore starts at the first missing page with no token replay.
   */
  async pause(jobId: string): Promise<ExtractionJob> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw errors.extractionJobNotFound(jobId);
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'paused') {
      return job;
    }
    this.runs.abort(jobId, 'cancelled');
    await this.queue.cancel(jobId);
    const paused = await this.jobs.update(jobId, { status: 'paused', finishedAt: null });
    await this.documents.updateStatus(job.documentId, 'failed');
    return paused;
  }

  /** Resume the latest paused or failed run, retaining all of its persisted page drafts. */
  async resume(documentId: string): Promise<ExtractionJob> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    const job = await this.jobs.findLatestByDocument(documentId);
    if (!job || (job.status !== 'paused' && job.status !== 'failed')) {
      throw errors.extractionNotResumable(documentId);
    }
    const resumed = await this.jobs.update(job.id, {
      status: 'queued',
      error: null,
      finishedAt: null,
    });
    await this.documents.updateStatus(documentId, 'queued');
    await this.queue.enqueue({ jobId: job.id, documentId, task: 'prepare' });
    return resumed;
  }

  /**
   * Stop a stuck/orphaned extraction by DOCUMENT id — the operator-facing "Stop" any viewer can hit,
   * unlike {@link cancel} which needs the job id the starting tab kept in memory. Best-effort aborts
   * the in-process run and drops a still-queued entry, closes the latest job, and returns the document
   * to a re-runnable `failed` state. A no-op (returns the document unchanged) when it isn't in flight.
   */
  async resetDocument(documentId: string): Promise<Document> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.status !== 'queued' && document.status !== 'extracting') return document;

    const job = await this.jobs.findLatestByDocument(documentId);
    if (job) {
      this.runs.abort(job.id, 'cancelled');
      await this.queue.cancel(job.id);
      if (job.status === 'queued' || job.status === 'running') {
        await this.jobs.update(job.id, { status: 'cancelled', finishedAt: new Date().toISOString() });
      }
    }
    return this.documents.updateStatus(documentId, 'failed');
  }
}
