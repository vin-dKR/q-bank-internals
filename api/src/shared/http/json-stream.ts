import type { Response } from 'express';
import { JSON_STREAM_CONTENT_TYPE } from '@ingest/contracts';

export function startJsonStream(res: Response): void {
  res.status(200).set({
    'Content-Type': `${JSON_STREAM_CONTENT_TYPE}; charset=utf-8`,
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

/** A disconnected viewer must not interrupt usage recording for requests already in flight. */
export function writeJsonStreamEvent(res: Response, event: unknown): void {
  if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}
