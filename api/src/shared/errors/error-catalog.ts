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

  questionNotFound: (id: string): AppError =>
    new AppError('QUESTION_NOT_FOUND', 404, `No question with id "${id}".`),

  comprehensionGroupNotFound: (groupId: string): AppError =>
    new AppError(
      'COMPREHENSION_GROUP_NOT_FOUND',
      404,
      `No comprehension group with id "${groupId}" in this document.`,
    ),

  bankQuestionNotFound: (questionId: string): AppError =>
    new AppError(
      'BANK_QUESTION_NOT_FOUND',
      404,
      `No published bank question is linked to ingest question "${questionId}".`,
    ),

  pageNotFound: (documentId: string, page: number): AppError =>
    new AppError('PAGE_NOT_FOUND', 404, `Document "${documentId}" has no page ${String(page)}.`),

  imageUploadFailed: (reason: string): AppError =>
    new AppError('IMAGE_UPLOAD_FAILED', 502, `Image upload failed: ${reason}`),

  documentAlreadyRegistered: (driveFileId: string): AppError =>
    new AppError(
      'DOCUMENT_ALREADY_REGISTERED',
      409,
      `Drive file "${driveFileId}" is already registered.`,
    ),

  extractionInProgress: (documentId: string): AppError =>
    new AppError('EXTRACTION_IN_PROGRESS', 409, `Document "${documentId}" is already extracting.`),

  documentUnitVersionExists: (fileName: string, status: string): AppError =>
    new AppError(
      'DOCUMENT_UNIT_VERSION_EXISTS',
      409,
      `"${fileName}" already exists in this unit (status "${status}"). Stop or delete that version ` +
        `before re-uploading, so it isn't duplicated.`,
    ),

  extractionJobNotFound: (id: string): AppError =>
    new AppError('EXTRACTION_JOB_NOT_FOUND', 404, `No extraction job with id "${id}".`),

  extractionTimedOut: (ms: number): AppError =>
    new AppError(
      'EXTRACTION_TIMED_OUT',
      504,
      `Extraction exceeded the ${String(ms)}ms time limit and was stopped. Re-run to try again.`,
    ),

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

  driveFolderNotEmpty: (id: string): AppError =>
    new AppError(
      'DRIVE_FOLDER_NOT_EMPTY',
      409,
      `Folder "${id}" is not empty. Delete its contents first, or confirm a force delete.`,
    ),

  uploadMissingFile: (): AppError =>
    new AppError('UPLOAD_MISSING_FILE', 400, 'No PDF file was included in the upload.'),

  uploadStagingNotConfigured: (): AppError =>
    new AppError(
      'UPLOAD_STAGING_NOT_CONFIGURED',
      502,
      'Direct-to-storage upload is not configured. Set SUPABASE_SERVICE_KEY to accept PDF uploads.',
    ),

  uploadStagingFailed: (reason: string): AppError =>
    new AppError('UPLOAD_STAGING_FAILED', 502, `Direct upload to storage failed: ${reason}`),

  uploadStagingInvalidPath: (): AppError =>
    new AppError('UPLOAD_STAGING_INVALID_PATH', 400, 'The upload reference is not a staged object.'),

  promptMissingTokens: (key: string, tokens: string[]): AppError =>
    new AppError(
      'PROMPT_MISSING_TOKENS',
      400,
      `The "${key}" prompt must keep these placeholders: ${tokens.map((t) => `{${t}}`).join(', ')}.`,
    ),

  extractionFailed: (reason: string): AppError =>
    new AppError('EXTRACTION_FAILED', 502, `The vision model failed: ${reason}`),

  publishWriteFailed: (reason: string): AppError =>
    new AppError('PUBLISH_WRITE_FAILED', 502, `Publishing to the question bank failed: ${reason}`),

  documentNotPublishable: (id: string, status: string): AppError =>
    new AppError(
      'DOCUMENT_NOT_PUBLISHABLE',
      409,
      `Document "${id}" is "${status}"; only extracted documents can be published.`,
    ),

  detectionFailed: (reason: string): AppError =>
    new AppError('DETECTION_FAILED', 502, `Figure detection failed: ${reason}`),

  tokenLimitExceeded: (window: 'daily' | 'weekly', used: number, limit: number): AppError =>
    new AppError(
      'TOKEN_LIMIT_EXCEEDED',
      429,
      `Token budget exceeded: ${window} usage (${String(used)} tokens) has reached the ` +
        `limit of ${String(limit)}. New extractions are blocked until usage rolls off the ` +
        `window or the limit is raised.`,
    ),

  internal: (): AppError => new AppError('INTERNAL', 500, 'Something went wrong.'),
} as const;
