import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../../shared/logger/logger.js';
import type { ExtractionJobPayload, JobQueue } from '../../modules/extraction/index.js';

const QUEUE_NAME = 'extraction';

/**
 * Production {@link JobQueue} backed by BullMQ (Redis). The API process constructs this and only
 * ever `enqueue`s; the separate worker process constructs it and calls `process` to consume. Keeping
 * the heavy extraction off the request path is the whole reason the queue exists.
 */
export class BullMqJobQueue implements JobQueue {
  readonly usesExternalConsumer = true;
  private readonly connection: Redis;
  private readonly queue: Queue<ExtractionJobPayload>;
  private worker: Worker<ExtractionJobPayload> | null = null;

  constructor(redisUrl: string) {
    // `maxRetriesPerRequest: null` is required by BullMQ's blocking commands.
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(payload: ExtractionJobPayload): Promise<void> {
    // Pin each page task independently so retries/resumes cannot overwrite a neighbouring page.
    await this.queue.add('extract', payload, {
      jobId: [payload.jobId, payload.task ?? 'prepare', payload.pageNumber ?? 0].join(':'),
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    try {
      // Removes the entry while it is still waiting; throws once a worker has locked it (active).
      await job.remove();
    } catch (error) {
      logger.warn(
        { jobId, err: error instanceof Error ? error.message : String(error) },
        'BullMQ job could not be removed (already active); the run must stop via its AbortController',
      );
    }
  }

  process(handler: (payload: ExtractionJobPayload) => Promise<void>): void {
    this.worker = new Worker<ExtractionJobPayload>(
      QUEUE_NAME,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, error) => {
      logger.error({ jobId: job?.id, err: error.message }, 'BullMQ extraction job failed');
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
