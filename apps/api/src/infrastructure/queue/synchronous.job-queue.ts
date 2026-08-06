import { logger } from '../../shared/logger/logger.js';
import type { ExtractionJobPayload, JobQueue } from '../../modules/extraction/index.js';

/**
 * Serverless {@link JobQueue}: runs the handler INLINE and awaits it, so extraction finishes before
 * `enqueue` resolves — and therefore before the HTTP response is sent. On a serverless platform
 * (Vercel) the process is frozen the instant the response returns, so the detached
 * {@link InProcessJobQueue} would have its background work killed mid-flight. Here the request pays
 * the full cost of extraction instead, which is the trade the platform forces.
 *
 * The caller (`ExtractionService.enqueue`) still returns the freshly-created job; by the time this
 * resolves the worker has already advanced that job/document to its terminal state in the store, so
 * clients see the final status on their next poll.
 */
export class SynchronousJobQueue implements JobQueue {
  private handler: ((payload: ExtractionJobPayload) => Promise<void>) | null = null;

  async enqueue(payload: ExtractionJobPayload): Promise<void> {
    const handler = this.handler;
    if (!handler) {
      logger.warn({ payload }, 'SynchronousJobQueue: no handler registered; dropping job');
      return;
    }
    // Run inline and AWAIT: the request must not return until extraction is done, or the frozen
    // serverless function would abandon it. A failing handler is logged but never rejects enqueue,
    // matching the in-process queue's contract (the job store already records the failure).
    try {
      await handler(payload);
    } catch (error: unknown) {
      logger.error({ payload, err: String(error) }, 'SynchronousJobQueue: handler threw');
    }
  }

  process(handler: (payload: ExtractionJobPayload) => Promise<void>): void {
    this.handler = handler;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
