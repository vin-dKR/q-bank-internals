import type { ErrorRequestHandler } from 'express';
import { JSON_STREAM_CONTENT_TYPE } from '@ingest/contracts';
import { writeJsonStreamEvent } from '../http/json-stream.js';
import { AppError } from '../errors/app-error.js';
import { errors } from '../errors/error-catalog.js';
import { logger } from '../logger/logger.js';

/**
 * The ONE error sink (§7). Mounted last. Turns any thrown value into a consistent JSON envelope.
 * Known `AppError`s are trusted and shown; unexpected errors are logged and hidden behind a 500 so
 * we never leak internals. The logger intentionally emits only 5xx backend failures, never routine
 * requests or expected client-side 4xx responses.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const appError = AppError.is(err) ? err : errors.internal();

  if (!AppError.is(err)) {
    logger.error({ err }, 'Unhandled error escaped to the error middleware');
  } else if (appError.status >= 500) {
    logger.error(
      { code: appError.code, status: appError.status, message: appError.message },
      'Backend request failed',
    );
  }

  if (res.headersSent) {
    if (String(res.getHeader('Content-Type')).startsWith(JSON_STREAM_CONTENT_TYPE)) {
      writeJsonStreamEvent(res, {
        type: 'error',
        error: {
          code: appError.code,
          status: appError.status,
          message: appError.message,
          details: appError.details ?? null,
        },
      });
      if (!res.destroyed && !res.writableEnded) res.end();
    } else next(err);
    return;
  }
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null,
    },
  });
};
