import { send } from '@vercel/queue';
import { logger } from '../../shared/logger/logger.js';
import type { ExtractionJobPayload, JobQueue } from '../../modules/extraction/index.js';

/** The private Vercel Queue topic consumed by `api/extraction-queue.ts`. */
export const EXTRACTION_QUEUE_TOPIC = 'ingest-extraction';

/**
 * Vercel's managed, durable queue. It replaces the old serverless synchronous adapter: publishing
 * returns immediately, while Vercel invokes the private consumer until each page task acknowledges.
 */
export class VercelJobQueue implements JobQueue {
  readonly usesExternalConsumer = true;

  async enqueue(payload: ExtractionJobPayload): Promise<void> {
    // Do not attach a 24-hour publish idempotency key here: a paused/failed job deliberately sends
    // the same `prepare` task again on Resume. The durable draft-store keys make duplicate delivery
    // harmless without preventing that legitimate continuation.
    await send(EXTRACTION_QUEUE_TOPIC, payload);
  }

  /** Vercel Queue has no per-message delete API. A cancelled job is acknowledged as a no-op by its consumer. */
  cancel(jobId: string): Promise<void> {
    logger.info({ jobId }, 'Extraction cancellation recorded; queued Vercel tasks will no-op');
    return Promise.resolve();
  }

  /** The Vercel Queue trigger owns delivery; see `api/extraction-queue.ts`. */
  process(): void {}

  close(): Promise<void> {
    return Promise.resolve();
  }
}
