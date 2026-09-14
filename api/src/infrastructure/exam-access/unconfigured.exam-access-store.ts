import type { OrgExamAccess, UserExamAccess } from '@ingest/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import type { ExamAccessStore } from '../../modules/exam-access/index.js';

/**
 * Null-object {@link ExamAccessStore} for the in-memory dev driver. Exam access reads/writes the main
 * Eduents accounts, which only exist in the shared Mongo — so reads return empty (the screen renders
 * with just the exam catalog) and writes fail loudly, exactly like the bank stores.
 */
export class UnconfiguredExamAccessStore implements ExamAccessStore {
  private unavailable(): AppError {
    return new AppError(
      'EXAM_ACCESS_UNAVAILABLE',
      400,
      'Exam access requires DB_DRIVER=mongo + DATABASE_URL (the shared Eduents database).',
    );
  }

  listExamNames(): Promise<string[]> {
    return Promise.resolve([]);
  }

  listOrganizations(): Promise<OrgExamAccess[]> {
    return Promise.resolve([]);
  }

  setOrganizationAllowedExams(): Promise<OrgExamAccess> {
    return Promise.reject(this.unavailable());
  }

  listUsers(): Promise<{ users: UserExamAccess[]; truncated: boolean }> {
    return Promise.resolve({ users: [], truncated: false });
  }

  setUserAllowedExams(): Promise<UserExamAccess> {
    return Promise.reject(this.unavailable());
  }
}
