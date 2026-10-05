/**
 * One durable checkpoint task. Every page gets its own message, so a 500-page PDF is a sequence of
 * short recoverable invocations instead of a 500-page HTTP request. `finalize` only reconciles
 * already-persisted drafts; it never calls the vision model again.
 */
export type ExtractionJobPayload = {
  jobId: string;
  documentId: string;
  task?: 'prepare' | 'question-page' | 'finalize';
  pageNumber?: number;
};

/**
 * The job-queue PORT (§3), owned by the extraction module. The API only ever `enqueue`s; a separate
 * worker process calls `process` to consume. Implemented in `infrastructure/queue` with BullMQ
 * (Redis) for production and an in-process adapter for dev, so the app boots with no Redis.
 */
export interface JobQueue {
  enqueue(payload: ExtractionJobPayload): Promise<void>;
  /** True when a platform-owned consumer (Vercel Queue/BullMQ worker) calls `process` elsewhere. */
  readonly usesExternalConsumer: boolean;
  /**
   * Drop the job for `jobId` from the queue if it is still waiting. Best-effort: a job already being
   * consumed can only be stopped by the run's AbortController (same-process queues), so a durable
   * BullMQ worker in another process cannot be aborted here — this only removes the queued entry.
   */
  cancel(jobId: string): Promise<void>;
  /** Register the consumer. Called by the worker process (and, for the in-process adapter, the API). */
  process(handler: (payload: ExtractionJobPayload) => Promise<void>): void;
  close(): Promise<void>;
}
