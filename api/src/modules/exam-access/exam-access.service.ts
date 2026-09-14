import type {
  ExamOption,
  ExamOptions,
  OrgExamAccess,
  OrgExamAccessList,
  UserExamAccess,
  UserExamAccessList,
} from '@ingest/contracts';
import { DEFAULT_EXAM_IDS } from './exam-options.js';
import type { ExamAccessStore, ExamAccessUserQuery } from './exam-access.repository.js';

/** Longest exam_name we will store — a guard against a pathological write, not a business rule. */
const MAX_EXAM_NAME_LENGTH = 120;

/**
 * The seam (§2) behind Masters → Exam access. Serves the LIVE exam catalog (the bank's distinct
 * `exam_name` values, so a newly-tagged exam is assignable with no code change), lists the main app's
 * organizations/users with their current entitlement, and persists a new entitlement. An empty list
 * is legal: it CLEARS the override (the account reverts to the inherited default).
 */
export class ExamAccessService {
  constructor(private readonly store: ExamAccessStore) {}

  /** The assignable exams (live from the bank) + the values that make up the "no override" default. */
  async examOptions(): Promise<ExamOptions> {
    const names = await this.store.listExamNames();
    const options: ExamOption[] = names.map((name) => ({ id: name, label: name }));
    return { options, defaultExamIds: [...DEFAULT_EXAM_IDS] };
  }

  async listOrganizations(): Promise<OrgExamAccessList> {
    return { organizations: await this.store.listOrganizations() };
  }

  setOrganization(id: string, allowedExams: string[]): Promise<OrgExamAccess> {
    return this.store.setOrganizationAllowedExams(id, this.sanitize(allowedExams));
  }

  listUsers(query: ExamAccessUserQuery): Promise<UserExamAccessList> {
    return this.store.listUsers(query);
  }

  setUser(id: string, allowedExams: string[]): Promise<UserExamAccess> {
    return this.store.setUserAllowedExams(id, this.sanitize(allowedExams));
  }

  /**
   * Trim, drop blanks, cap length, and de-duplicate case-insensitively. The catalog is data-driven
   * (any real `exam_name` is assignable), so there is no fixed allowlist to reject against — a value
   * that matches no bank exam simply shows nothing, which is harmless. This only stops empties and a
   * pathologically long string from being written onto a live account.
   */
  private sanitize(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const trimmed = value.trim().slice(0, MAX_EXAM_NAME_LENGTH);
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }
}
