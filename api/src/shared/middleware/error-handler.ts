import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { errors } from '../errors/error-catalog.js';
import { logger } from '../logger/logger.js';

/**
 * The ONE error sink (§7). Mounted last. Turns any thrown value into a consistent JSON envelope.
 * Known `AppError`s are trusted and shown; unexpected errors are logged and hidden behind a 500 so
 * we never leak internals. The logger intentionally emits only 5xx backend failures, never routine
 * requests or expected client-side 4xx responses.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appError = AppError.is(err) ? err : errors.internal();

  if (!AppError.is(err)) {
    logger.error({ err }, 'Unhandled error escaped to the error middleware');
  } else if (appError.status >= 500) {
    logger.error(
      { code: appError.code, status: appError.status, message: appError.message },
      'Backend request failed',
    );
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null,
    },
  });
};
