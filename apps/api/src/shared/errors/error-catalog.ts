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

  sessionNotFound: (id: string): AppError =>
    new AppError('SESSION_NOT_FOUND', 404, `No session with id "${id}".`),

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

  driveQuotaExceeded: (): AppError =>
    new AppError(
      'DRIVE_QUOTA_EXCEEDED',
      507,
      'The Drive service account has no storage quota, so it cannot upload files. ' +
        'Point DRIVE_ROOT_FOLDER_ID at a Shared Drive, or switch to OAuth user credentials.',
    ),

  driveWriteFailed: (reason: string): AppError =>
    new AppError('DRIVE_WRITE_FAILED', 502, `Drive upload failed: ${reason}`),

  uploadMissingFile: (): AppError =>
    new AppError('UPLOAD_MISSING_FILE', 400, 'No PDF file was included in the upload.'),

  uploadTooLarge: (maxBytes: number): AppError =>
    new AppError(
      'UPLOAD_TOO_LARGE',
      413,
      `The uploaded PDF exceeds the ${String(maxBytes)}-byte limit.`,
    ),

  extractionFailed: (reason: string): AppError =>
    new AppError('EXTRACTION_FAILED', 502, `The vision model failed: ${reason}`),

  internal: (): AppError => new AppError('INTERNAL', 500, 'Something went wrong.'),
} as const;
