import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionFixStore } from '../../modules/quality/index.js';

/**
 * Null-object {@link QuestionFixStore} for the in-memory dev driver. Unlike the read side (which degrades
 * to an empty dashboard), a write must fail loudly: there is no bank to correct, and silently accepting the
 * fix would tell the operator their correction was saved.
 */
export class UnconfiguredQuestionFixStore implements QuestionFixStore {
  apply(): Promise<void> {
    return Promise.reject(errors.qualityWriteFailed('no database is configured (DB_DRIVER=memory).'));
  }

  applyMany(): Promise<number> {
    return Promise.reject(errors.qualityWriteFailed('no database is configured (DB_DRIVER=memory).'));
  }
}
