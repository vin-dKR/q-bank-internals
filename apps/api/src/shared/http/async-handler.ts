import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async controller so a rejected promise reaches the error middleware (§7)
 * instead of hanging the request. Every async route handler MUST be wrapped in this —
 * it is why controllers never need a try/catch for flow control.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
