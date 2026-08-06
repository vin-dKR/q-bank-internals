import { logger } from '../../shared/logger/logger.js';
import type { ExtractionJobPayload, JobQueue } from '../../modules/extraction/index.js';

/**
 * Dev/default {@link JobQueue} that runs the handler in-process, so the app extracts without Redis
 * (mirrors the in-memory DB driver). `enqueue` returns immediately and the work runs detached, so
 * the API response is never blocked — the same "don't wait on Phase 2" guarantee BullMQ gives.
 */
export class InProcessJobQueue implements JobQueue {
  private handler: ((payload: ExtractionJobPayload) => Promise<void>) | null = null;

  enqueue(payload: ExtractionJobPayload): Promise<void> {
    const handler = this.handler;
    if (!handler) {
      logger.warn({ payload }, 'InProcessJobQueue: no handler registered; dropping job');
      return Promise.resolve();
    }
    // Run detached; a failing handler must never reject the enqueue call.
    void handler(payload).catch((error: unknown) => {
      logger.error({ payload, err: String(error) }, 'InProcessJobQueue: handler threw');
    });
    return Promise.resolve();
  }

  process(handler: (payload: ExtractionJobPayload) => Promise<void>): void {
    this.handler = handler;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
