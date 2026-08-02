import type { Response } from 'express';

/**
 * The single shape every successful response is sent through, so the frontend's http client
 * can unwrap `{ data }` in exactly one place. Errors go through the error middleware, not here.
 */
export function ok(res: Response, data: unknown, status = 200): Response {
  return res.status(status).json({ data });
}
