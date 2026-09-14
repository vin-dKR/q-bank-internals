import type { OrgExamAccess, UserExamAccess } from '@ingest/contracts';

/** Query for the user list: an optional name/email substring and a page cap (already parsed). */
export type ExamAccessUserQuery = {
  q?: string | undefined;
  limit: number;
};

/**
 * PORT (§3) for the Masters → Exam access feature: reads a slice of the MAIN Eduents app's
 * `Organization` / `User` / `Membership` collections and writes their `allowedExams` entitlement.
 * Like the bank stores, these live in the shared "banks" database and have no Prisma model here, so
 * the mongo implementation uses raw commands; the dev driver is a null-object. `allowedExams` values
 * are validated against the fixed catalog by the service BEFORE they reach a setter here.
 */
export interface ExamAccessStore {
  /** The live distinct `exam_name` values tagged in the bank — the assignable exam set. */
  listExamNames(): Promise<string[]>;
  /** Real (coaching/school) organizations with their entitlement + member count, name-sorted. */
  listOrganizations(): Promise<OrgExamAccess[]>;
  /** Replace one org's `allowedExams` (keyed by its Mongo `_id`); returns the updated row. */
  setOrganizationAllowedExams(id: string, allowedExams: string[]): Promise<OrgExamAccess>;
  /** A capped, optionally-searched page of users with their per-user override + org context. */
  listUsers(query: ExamAccessUserQuery): Promise<{ users: UserExamAccess[]; truncated: boolean }>;
  /** Replace one user's `allowedExams` (keyed by its Mongo `_id`); returns the updated row. */
  setUserAllowedExams(id: string, allowedExams: string[]): Promise<UserExamAccess>;
}
