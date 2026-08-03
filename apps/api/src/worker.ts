import { env } from './config/index.js';
import { logger } from './shared/logger/logger.js';
import { createContainer } from './container.js';

/**
 * The extraction WORKER process entry point (§1). Separate from the API so the heavy vision work
 * never touches the request path. With BullMQ (REDIS_URL set) this process registers the consumer;
 * without Redis the in-process queue already runs inside the API, so a standalone worker is a no-op.
 */
function main(): void {
  const container = createContainer();

  if (!env.REDIS_URL) {
    logger.warn(
      'No REDIS_URL: the in-process queue runs inside the API, so this worker has nothing to do. ' +
        'Set REDIS_URL to run a standalone BullMQ worker.',
    );
    return;
  }

  container.jobQueue.process((payload) => container.extractionWorker.run(payload));
  logger.info('Extraction worker started; draining the BullMQ queue.');
}

main();
