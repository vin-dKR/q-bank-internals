import type { ExtractionJob } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { UsageService } from '../usage/index.js';
import type { ExtractionJobStore } from './extraction.repository.js';
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
   * Queue extraction for every not-yet-extracted question document in a session — the "run the whole
   * batch" action. Answer/solution PDFs are pulled in automatically by their question sibling, and
   * already-extracted files are skipped, so this never re-does completed work.
   */
  async enqueueSession(sessionId: string): Promise<{ enqueued: number }> {
    const documents = await this.documents.listBySession(sessionId);
    const targets = documents.filter(
      (document) =>
        document.kind === 'question' &&
        (document.status === 'uploaded' || document.status === 'failed'),
    );
    for (const document of targets) {
      await this.enqueue(document.id);
    }
    return { enqueued: targets.length };
  }

  async getJob(id: string): Promise<ExtractionJob> {
    const job = await this.jobs.findById(id);
    if (!job) throw errors.documentNotFound(id);
    return job;
  }
}
