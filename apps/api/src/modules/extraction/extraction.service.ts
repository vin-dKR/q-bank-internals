import type { ExtractionJob } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { ExtractionJobStore } from './extraction.repository.js';

/**
 * Owns the "hand a section PDF to the extractor" decision. It verifies the document exists, marks
 * it queued, and records a job. The heavy vision work runs in a separate worker (see README) that
 * consumes these jobs — the API stays fast and never blocks on the model.
 */
export class ExtractionService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly jobs: ExtractionJobStore,
    private readonly model: string,
  ) {}

  async start(documentId: string): Promise<ExtractionJob> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    if (document.status === 'extracting') throw errors.extractionInProgress(documentId);

    await this.documents.updateStatus(documentId, 'queued');
    return this.jobs.create({ documentId, model: this.model });
  }

  async getJob(id: string): Promise<ExtractionJob> {
    const job = await this.jobs.findById(id);
    if (!job) throw errors.documentNotFound(id);
    return job;
  }
}
