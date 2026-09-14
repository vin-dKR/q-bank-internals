import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { OrgExamAccess, UserExamAccess } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { ejsonNumber, escapeRegex, firstBatch, oid } from '../database/mongo-ejson.js';
import type { ExamAccessStore, ExamAccessUserQuery } from '../../modules/exam-access/index.js';

/** A 24-char hex Mongo ObjectId — validated before it becomes a `{ $oid }`, so a bad id 404s cleanly. */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * Upper bound on organizations returned in one listing. The org panel has no search, so this must
 * comfortably exceed the real tenant count; it also becomes the find `batchSize`, keeping the whole
 * result in a single reply. Raise it if a deployment ever approaches this many coaching/school orgs.
 */
const MAX_ORGS = 2000;

/** Distinct, non-empty strings out of a raw array value (drops nulls / non-strings). */
function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const strings = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(strings)];
}

/** One raw `Organization` document → the {@link OrgExamAccess} shape (member count filled in by caller). */
const RawOrgSchema = z
  .object({
    _id: oid,
    name: z.string().catch(''),
    type: z.string().catch(''),
    allowedExams: z.unknown(),
  })
  .transform((doc) => ({
    id: doc._id,
    name: doc.name,
    type: doc.type,
    allowedExams: cleanStrings(doc.allowedExams),
  }));

/** One raw `User` aggregate row (with `orgNames` joined in) → the {@link UserExamAccess} shape. */
const RawUserSchema = z
  .object({
    _id: oid,
    name: z.string().nullable().catch(null),
    email: z.string().catch(''),
    allowedExams: z.unknown(),
    orgNames: z.unknown(),
  })
  .transform(
    (doc): UserExamAccess => ({
      id: doc._id,
      name: doc.name,
      email: doc.email,
      allowedExams: cleanStrings(doc.allowedExams),
      orgNames: cleanStrings(doc.orgNames),
    }),
  );

/**
 * {@link ExamAccessStore} over the MAIN Eduents app's `Organization` / `User` / `Membership`
 * collections, using raw Mongo commands on the shared connection (these have no Prisma model here, so
 * — like the bank stores — this never touches their schema or indexes). Writes are scoped to the
 * single `allowedExams` field via `$set`, keyed by `_id`, so nothing else on a real account is ever
 * altered. Ids are validated against the catalog by the service before they arrive.
 */
export class MongoExamAccessStore implements ExamAccessStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly orgCollection = 'Organization',
    private readonly userCollection = 'User',
    private readonly membershipCollection = 'Membership',
    private readonly questionCollection = 'Question',
  ) {}

  async listExamNames(): Promise<string[]> {
    // `distinct` returns ALL values inline as `{ values: [...] }` (no cursor), so there is no
    // firstBatch/getMore paging concern here — the whole set arrives in one reply.
    const command = {
      distinct: this.questionCollection,
      key: 'exam_name',
      query: { exam_name: { $nin: [null, ''] } },
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    return cleanStrings((reply as { values?: unknown }).values).sort((a, b) => a.localeCompare(b));
  }

  async listOrganizations(): Promise<OrgExamAccess[]> {
    // Real tenants only — a 'personal' workspace is not something an operator entitles.
    const orgs = await this.readOrganizations(
      { type: { $in: ['coaching', 'school'] }, deletedAt: null },
      MAX_ORGS,
      { name: 1 },
    );
    // Counts are fetched AFTER the orgs and scoped to exactly this page's ids, so the aggregate can
    // never out-run its own single batch (see the batchSize note in readUsers/activeMemberCounts).
    const counts = await this.activeMemberCounts(orgs.map((org) => org.id));
    return orgs.map((org) => ({ ...org, memberCount: counts.get(org.id) ?? 0 }));
  }

  async setOrganizationAllowedExams(id: string, allowedExams: string[]): Promise<OrgExamAccess> {
    if (!OBJECT_ID.test(id)) throw errors.organizationNotFound(id);

    const matched = await this.setAllowedExams(this.orgCollection, id, allowedExams);
    if (matched === 0) throw errors.organizationNotFound(id);

    const [org] = await this.readOrganizations({ _id: { $oid: id } }, 1);
    if (!org) throw errors.organizationNotFound(id);
    const counts = await this.activeMemberCounts([id]);
    return { ...org, memberCount: counts.get(id) ?? 0 };
  }

  async listUsers(query: ExamAccessUserQuery): Promise<{ users: UserExamAccess[]; truncated: boolean }> {
    const match: Record<string, unknown> = { deletedAt: null };
    const keyword = query.q?.trim();
    if (keyword) {
      const pattern = escapeRegex(keyword);
      match.$or = [
        { name: { $regex: pattern, $options: 'i' } },
        { email: { $regex: pattern, $options: 'i' } },
      ];
    }
    // Over-fetch by one so the caller can tell the page was capped and prompt a narrower search.
    const rows = await this.readUsers(match, query.limit + 1);
    const truncated = rows.length > query.limit;
    return { users: truncated ? rows.slice(0, query.limit) : rows, truncated };
  }

  async setUserAllowedExams(id: string, allowedExams: string[]): Promise<UserExamAccess> {
    if (!OBJECT_ID.test(id)) throw errors.userNotFound(id);

    const matched = await this.setAllowedExams(this.userCollection, id, allowedExams);
    if (matched === 0) throw errors.userNotFound(id);

    const [user] = await this.readUsers({ _id: { $oid: id } }, 1);
    if (!user) throw errors.userNotFound(id);
    return user;
  }

  /** `$set` just `allowedExams` on one document by `_id`; returns the matched count. */
  private async setAllowedExams(collection: string, id: string, allowedExams: string[]): Promise<number> {
    const command = {
      update: collection,
      updates: [{ q: { _id: { $oid: id } }, u: { $set: { allowedExams } } }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    return ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
  }

  /**
   * Active-membership counts for exactly the given org ids → Map. Scoped by `$in` so the group can
   * produce at most `orgIds.length` rows, and `batchSize` is sized to hold them all in the single
   * `firstBatch` (Prisma's `$runCommandRaw` does not drain a cursor — an unset batchSize caps the
   * first batch at Mongo's default 101, which would silently under-count on large pages).
   */
  private async activeMemberCounts(orgIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (orgIds.length === 0) return counts;

    const command = {
      aggregate: this.membershipCollection,
      pipeline: [
        { $match: { status: 'active', organizationId: { $in: orgIds.map((id) => ({ $oid: id })) } } },
        { $group: { _id: '$organizationId', c: { $sum: 1 } } },
      ],
      cursor: { batchSize: orgIds.length + 1 },
    } as unknown as Prisma.InputJsonObject;

    for (const row of firstBatch(await this.prisma.$runCommandRaw(command))) {
      const parsed = z.object({ _id: oid, c: ejsonNumber.catch(0) }).safeParse(row);
      if (parsed.success) counts.set(parsed.data._id, parsed.data.c);
    }
    return counts;
  }

  private async readOrganizations(
    filter: Record<string, unknown>,
    limit: number,
    sort?: Record<string, 1 | -1>,
  ): Promise<Omit<OrgExamAccess, 'memberCount'>[]> {
    // batchSize >= limit so the whole (already-bounded) result lands in `firstBatch` — Prisma's
    // `$runCommandRaw` never issues getMore, so an unset batchSize would cap this at Mongo's default 101.
    const command = {
      find: this.orgCollection,
      filter,
      ...(sort ? { sort } : {}),
      limit,
      batchSize: limit,
    } as unknown as Prisma.InputJsonObject;
    const out: Omit<OrgExamAccess, 'memberCount'>[] = [];
    for (const raw of firstBatch(await this.prisma.$runCommandRaw(command))) {
      const parsed = RawOrgSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  /**
   * Users matching `match`, newest first, each with the NAMES of the orgs they belong to (two
   * `$lookup`s: user → memberships → organizations). `orgNames` is display context only.
   */
  private async readUsers(match: Record<string, unknown>, limit: number): Promise<UserExamAccess[]> {
    const command = {
      aggregate: this.userCollection,
      pipeline: [
        { $match: match },
        { $sort: { _id: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: this.membershipCollection,
            localField: '_id',
            foreignField: 'userId',
            as: 'memberships',
          },
        },
        {
          $lookup: {
            from: this.orgCollection,
            localField: 'memberships.organizationId',
            foreignField: '_id',
            as: 'orgs',
          },
        },
        { $project: { name: 1, email: 1, allowedExams: 1, orgNames: '$orgs.name' } },
      ],
      // batchSize >= the `$limit` so the whole page returns in `firstBatch` (Prisma's raw command
      // does not drain the cursor; an unset batchSize would cap this at Mongo's default 101).
      cursor: { batchSize: limit },
    } as unknown as Prisma.InputJsonObject;

    const users: UserExamAccess[] = [];
    for (const raw of firstBatch(await this.prisma.$runCommandRaw(command))) {
      const parsed = RawUserSchema.safeParse(raw);
      if (parsed.success) users.push(parsed.data);
    }
    return users;
  }
}
