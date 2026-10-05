import { AppError } from './app-error.js';
import type { StructureDetectionUsage } from '@ingest/contracts';

/**
 * Every error the API can produce, in one place. Callers do `throw errors.documentNotFound(id)`,
 * so status codes and error codes never drift. Add new errors here, not inline.
 */
export const errors = {
  structureRuleWriteFailed: (): AppError =>
    new AppError('STRUCTURE_RULE_WRITE_FAILED', 500, 'Could not save structure rules. Try again.'),
  structureDetectionChargedFailure: (error: AppError, usage: StructureDetectionUsage): AppError =>
    new AppError(error.code, error.status, error.message, { usage }),
  structureDetectionFailed: (reason: string): AppError =>
    new AppError('STRUCTURE_DETECTION_FAILED', 422, `Structure detection failed: ${reason}`),
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

  passageNotResolved: (questionId: string, passageId: string): AppError =>
    new AppError(
      'PASSAGE_NOT_RESOLVED',
      500,
      `Question "${questionId}" references comprehension passage "${passageId}", which was not found in this document. Re-extract the document before publishing.`,
    ),

  bankQuestionNotFound: (questionId: string): AppError =>
    new AppError(
      'BANK_QUESTION_NOT_FOUND',
      404,
      `No published bank question is linked to ingest question "${questionId}".`,
    ),

  bankGroupNotFound: (groupId: string): AppError =>
    new AppError(
      'BANK_GROUP_NOT_FOUND',
      404,
      `No published bank questions belong to comprehension group "${groupId}".`,
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

  documentNotReextractable: (id: string, status: string): AppError =>
    new AppError(
      'DOCUMENT_NOT_REEXTRACTABLE',
      409,
      `Document "${id}" is "${status}" and cannot be re-extracted. Published documents must be revised through the published-question workflow.`,
    ),

  documentUnitVersionExists: (fileName: string, status: string): AppError =>
    new AppError(
      'DOCUMENT_UNIT_VERSION_EXISTS',
      409,
      `"${fileName}" already exists in this unit (status "${status}"). Stop or delete that version ` +
        `before re-uploading, so it isn't duplicated.`,
    ),

  extractionJobNotFound: (id: string): AppError =>
    new AppError('EXTRACTION_JOB_NOT_FOUND', 404, `No extraction job with id "${id}".`),

  extractionNotResumable: (documentId: string): AppError =>
    new AppError(
      'EXTRACTION_NOT_RESUMABLE',
      409,
      `Document "${documentId}" has no paused or failed extraction with saved page checkpoints to resume.`,
    ),

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
    new AppError(
      'UPLOAD_STAGING_INVALID_PATH',
      400,
      'The upload reference is not a staged object.',
    ),

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

  matrixNotPublishable: (questionId: string, reason: string): AppError =>
    new AppError(
      'MATRIX_NOT_PUBLISHABLE',
      422,
      `Matrix question "${questionId}" cannot be published: ${reason}. Complete the matching table or correct its selected option in Verify.`,
    ),

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

  anomalyNotFound: (id: string): AppError =>
    new AppError('ANOMALY_NOT_FOUND', 404, `No quality anomaly with id "${id}".`),

  aiProposalNotPending: (id: string): AppError =>
    new AppError(
      'AI_PROPOSAL_NOT_PENDING',
      404,
      `No pending AI proposal with id "${id}" — it may already have been applied or discarded.`,
    ),

  aiCouldNotDecide: (detail: string): AppError =>
    new AppError(
      'AI_COULD_NOT_DECIDE',
      422,
      `The AI could not decide an answer that fits: ${detail || 'no reason given.'}`,
    ),

  /** A topic was asked for on a question whose subject is unset or has no topics in Question taxonomy. */
  topicNotMatchable: (reason: string): AppError => new AppError('TOPIC_NOT_MATCHABLE', 422, reason),

  qualityWriteFailed: (reason: string): AppError =>
    new AppError('QUALITY_WRITE_FAILED', 502, `Saving quality anomalies failed: ${reason}`),

  qualityScanInProgress: (scanId: string): AppError =>
    new AppError(
      'QUALITY_SCAN_IN_PROGRESS',
      409,
      `A quality scan is already running (${scanId}). Wait for it to finish before starting another.`,
    ),

  // Exam-access (Masters → Exam access) writes target live Eduents accounts by their Mongo `_id`.
  organizationNotFound: (id: string): AppError =>
    new AppError('ORGANIZATION_NOT_FOUND', 404, `No organization with id "${id}".`),

  userNotFound: (id: string): AppError =>
    new AppError('USER_NOT_FOUND', 404, `No user with id "${id}".`),

  // Masters → Question taxonomy: CRUD over the shared bank's dictionary collections.
  dictionaryValueRejected: (dimension: string, value: string): AppError =>
    new AppError(
      'DICTIONARY_VALUE_REJECTED',
      400,
      `"${value}" is not a valid ${dimension} value (it is empty, junk, or outside a closed vocabulary).`,
    ),

  dictionaryEntryExists: (dimension: string, name: string): AppError =>
    new AppError(
      'DICTIONARY_ENTRY_EXISTS',
      409,
      `A ${dimension} entry for "${name}" already exists. Edit that entry to add a spelling instead.`,
    ),

  dictionaryEntryNotFound: (dimension: string, id: string): AppError =>
    new AppError('DICTIONARY_ENTRY_NOT_FOUND', 404, `No ${dimension} entry with id "${id}".`),

  dictionaryEntryInUse: (name: string, count: number): AppError =>
    new AppError(
      'DICTIONARY_ENTRY_IN_USE',
      409,
      `"${name}" is used by ${String(count)} bank question(s) and cannot be deleted. Reassign them first.`,
    ),

  dictionaryEntryHasChildren: (name: string, child: string, count: number): AppError =>
    new AppError(
      'DICTIONARY_ENTRY_HAS_CHILDREN',
      409,
      `"${name}" still has ${String(count)} ${child} entr${count === 1 ? 'y' : 'ies'} and cannot be deleted. Move or delete them first.`,
    ),

  dictionaryDimensionClosed: (dimension: string): AppError =>
    new AppError(
      'DICTIONARY_DIMENSION_CLOSED',
      400,
      `The ${dimension} vocabulary is closed; its entries cannot be deleted (edit name/aliases instead).`,
    ),

  dictionaryFieldNotAllowed: (dimension: string, field: string): AppError =>
    new AppError(
      'DICTIONARY_FIELD_NOT_ALLOWED',
      400,
      `"${field}" cannot be set on a ${dimension} entry.`,
    ),

  dictionaryParentNotFound: (parent: string, id: string): AppError =>
    new AppError(
      'DICTIONARY_PARENT_NOT_FOUND',
      400,
      `No ${parent} with id "${id}" to scope this entry to.`,
    ),

  dictionaryParentRequired: (dimension: string, parent: string): AppError =>
    new AppError(
      'DICTIONARY_PARENT_REQUIRED',
      400,
      `A ${parent} is required when creating or moving a ${dimension}.`,
    ),

  dictionaryWriteFailed: (reason: string): AppError =>
    new AppError(
      'DICTIONARY_WRITE_FAILED',
      502,
      `Writing the taxonomy dictionary failed: ${reason}`,
    ),

  taxonomyUnavailable: (): AppError =>
    new AppError(
      'TAXONOMY_UNAVAILABLE',
      400,
      'Question taxonomy requires DB_DRIVER=mongo + DATABASE_URL (the shared Eduents database).',
    ),

  internal: (): AppError => new AppError('INTERNAL', 500, 'Something went wrong.'),
} as const;
