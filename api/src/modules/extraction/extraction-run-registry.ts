/** Why an in-flight extraction run was aborted — distinguishes an operator cancel from a timeout. */
export type ExtractionAbortReason = 'cancelled' | 'timeout';

/**
 * In-process registry of the {@link AbortController}s for extraction runs executing in THIS process,
 * keyed by job id. The worker registers a controller when a run starts and releases it when the run
 * ends; the service's cancel action and the worker's own deadline timer both abort through it. It
 * coordinates cancel/timeout within one process — the in-process (dev) and synchronous (serverless)
 * queues run the worker inside the API, which is exactly where an operator's cancel request meets the
 * running job. A cross-process BullMQ worker additionally drops still-queued jobs via the queue port.
 */
export class ExtractionRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  /** Begin tracking a run; returns the controller whose signal the run threads into its I/O. */
  register(jobId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    return controller;
  }

  /** Abort the tracked run for `jobId`, if one is live in this process. Returns whether it signalled. */
  abort(jobId: string, reason: ExtractionAbortReason): boolean {
    const controller = this.controllers.get(jobId);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  /** Stop tracking a finished run so its controller can be collected. */
  release(jobId: string): void {
    this.controllers.delete(jobId);
  }
}
