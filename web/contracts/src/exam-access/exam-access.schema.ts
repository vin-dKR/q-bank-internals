import { z } from 'zod';

/**
 * The api ⇄ web boundary for Masters → Exam access: the operator screen that controls WHICH exam
 * families each Eduents organization / user may see in the main app's question bank. The main app
 * reads `Organization.allowedExams` / `User.allowedExams` on its hot path; this feature is the only
 * writer of those fields. Ids are the stable exam keys the main app stores (a FIXED mirror of its
 * `questionExamOptions` — see api/src/modules/exam-access/exam-options.ts).
 */

/** One assignable exam family. `id` is stored on the entity's `allowedExams`; `label` is operator-facing. */
export const ExamOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type ExamOption = z.infer<typeof ExamOptionSchema>;

/** The fixed catalog of assignable exams, plus the ids that make up the "no override" default. */
export const ExamOptionsSchema = z.object({
  options: z.array(ExamOptionSchema),
  /** What an entity effectively sees when its `allowedExams` is empty (JEE / NEET / Boards). */
  defaultExamIds: z.array(z.string()),
});
export type ExamOptions = z.infer<typeof ExamOptionsSchema>;

/**
 * A real (non-personal) Eduents organization with its current entitlement. `allowedExams` is empty
 * when no override is set — the org then falls back to the default. Assigning a non-empty list makes
 * the org (and everyone in it, unless a user has their own override) see ONLY those exam families.
 */
export const OrgExamAccessSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 'coaching' | 'school' (personal orgs are never listed). */
  type: z.string(),
  allowedExams: z.array(z.string()),
  memberCount: z.number().int().nonnegative(),
});
export type OrgExamAccess = z.infer<typeof OrgExamAccessSchema>;

export const OrgExamAccessListSchema = z.object({
  organizations: z.array(OrgExamAccessSchema),
});
export type OrgExamAccessList = z.infer<typeof OrgExamAccessListSchema>;

/**
 * One Eduents user with their PER-USER override. Empty `allowedExams` means "inherit" — the user
 * sees whatever their active org (or the default) allows. A non-empty list wins over the org's.
 * `orgNames` is context only, so the operator can tell two same-named people apart.
 */
export const UserExamAccessSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  allowedExams: z.array(z.string()),
  orgNames: z.array(z.string()),
});
export type UserExamAccess = z.infer<typeof UserExamAccessSchema>;

export const UserExamAccessListSchema = z.object({
  users: z.array(UserExamAccessSchema),
  /** True when the list was capped at `limit` — the operator should narrow with a search. */
  truncated: z.boolean(),
});
export type UserExamAccessList = z.infer<typeof UserExamAccessListSchema>;

/** Query for the user list: an optional name/email substring and a page cap. */
export const UserExamAccessQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type UserExamAccessQuery = z.infer<typeof UserExamAccessQuerySchema>;

/**
 * Body to set an entity's entitlement. The list REPLACES the stored one; `[]` clears the override so
 * the entity reverts to the inherited/default set. Unknown ids are rejected server-side against the
 * fixed catalog, so a stale client can never write a junk exam id onto a real account.
 */
export const UpdateExamAccessSchema = z.object({
  allowedExams: z.array(z.string()),
});
export type UpdateExamAccess = z.infer<typeof UpdateExamAccessSchema>;
