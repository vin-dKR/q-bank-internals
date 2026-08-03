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
  private readonly connection: Redis;
  private readonly queue: Queue<ExtractionJobPayload>;
  private worker: Worker<ExtractionJobPayload> | null = null;

  constructor(redisUrl: string) {
    // `maxRetriesPerRequest: null` is required by BullMQ's blocking commands.
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(payload: ExtractionJobPayload): Promise<void> {
    await this.queue.add('extract', payload, { removeOnComplete: true, removeOnFail: 100 });
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
