/** The unit of work handed to the extraction worker: which job row, for which document. */
export type ExtractionJobPayload = { jobId: string; documentId: string };

/**
 * The job-queue PORT (§3), owned by the extraction module. The API only ever `enqueue`s; a separate
 * worker process calls `process` to consume. Implemented in `infrastructure/queue` with BullMQ
 * (Redis) for production and an in-process adapter for dev, so the app boots with no Redis.
 */
export interface JobQueue {
  enqueue(payload: ExtractionJobPayload): Promise<void>;
  /** Register the consumer. Called by the worker process (and, for the in-process adapter, the API). */
  process(handler: (payload: ExtractionJobPayload) => Promise<void>): void;
  close(): Promise<void>;
}
