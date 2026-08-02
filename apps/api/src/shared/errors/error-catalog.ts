import { AppError } from './app-error.js';

/**
 * Every error the API can produce, in one place. Callers do `throw errors.documentNotFound(id)`,
 * so status codes and error codes never drift. Add new errors here, not inline.
 */
export const errors = {
  validation: (details: unknown): AppError =>
    new AppError('VALIDATION_FAILED', 400, 'Request failed validation.', details),

  documentNotFound: (id: string): AppError =>
    new AppError('DOCUMENT_NOT_FOUND', 404, `No document with id "${id}".`),

  documentAlreadyRegistered: (driveFileId: string): AppError =>
    new AppError(
      'DOCUMENT_ALREADY_REGISTERED',
      409,
      `Drive file "${driveFileId}" is already registered.`,
    ),

  extractionInProgress: (documentId: string): AppError =>
    new AppError('EXTRACTION_IN_PROGRESS', 409, `Document "${documentId}" is already extracting.`),

  driveUnavailable: (): AppError =>
    new AppError('DRIVE_UNAVAILABLE', 502, 'Google Drive could not be reached.'),

  extractionFailed: (reason: string): AppError =>
    new AppError('EXTRACTION_FAILED', 502, `The vision model failed: ${reason}`),

  internal: (): AppError => new AppError('INTERNAL', 500, 'Something went wrong.'),
} as const;
