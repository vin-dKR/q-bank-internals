import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { errors } from '../errors/error-catalog.js';
import { logger } from '../logger/logger.js';

/**
 * The ONE error sink (§7). Mounted last. Turns any thrown value into a consistent JSON envelope.
 * Known `AppError`s are trusted and shown; anything else is logged and hidden behind a 500 so we
 * never leak internals. Controllers rely on this existing — they don't catch to build responses.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appError = AppError.is(err) ? err : errors.internal();

  if (!AppError.is(err)) {
    logger.error({ err }, 'Unhandled error escaped to the error middleware');
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null,
    },
  });
};
