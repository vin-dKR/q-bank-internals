import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { TaxonomyDimension } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import {
  cleanStrings,
  ejsonNumber,
  escapeRegex,
  firstBatch,
  oid,
  optionalOid,
} from '../database/mongo-ejson.js';
import type {
  DictionaryFilter,
  DictionaryPatch,
  DictionaryRow,
  NewDictionaryRow,
  TaxonomyStore,
} from '../../modules/masters/index.js';

/** A 24-char hex Mongo ObjectId — validated before it becomes a `{ $oid }`, so a bad id 404s cleanly. */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Dictionaries are small reference sets; this cap holds the whole collection in one raw `find` batch. */
const MAX_ENTRIES = 5000;

/** Each managed dimension → its eduents dictionary collection. */
const COLLECTION: Record<TaxonomyDimension, string> = {
  exam: 'Exam',
  subject: 'Subject',
  module: 'Module',
  chapter: 'Chapter',
  section: 'Section',
  questionType: 'QuestionType',
  level: 'Level',
  topic: 'Topic',
};

/** Each dimension → the `Question` FK column that references one of its entries (for usage counts). */
const QUESTION_FK: Record<TaxonomyDimension, string> = {
  exam: 'examId',
  subject: 'subjectId',
  module: 'moduleId',
  chapter: 'chapterId',
  section: 'sectionId',
  questionType: 'questionTypeId',
  level: 'levelId',
  topic: 'topicId',
};

/** One raw dictionary document → the {@link DictionaryRow} shape (per-dimension extras null when absent). */
const RawDictSchema = z
  .object({
    _id: oid,
    key: z.string().catch(''),
    name: z.string().catch(''),
    aliases: z.unknown(),
    kind: z.string().nullable().catch(null),
    rank: ejsonNumber.nullable().catch(null),
    subjectId: optionalOid,
    chapterId: optionalOid,
  })
  .transform(
    (doc): DictionaryRow => ({
      id: doc._id,
      key: doc.key,
      name: doc.name,
      aliases: cleanStrings(doc.aliases),
      kind: doc.kind,
      rank: doc.rank,
      subjectId: doc.subjectId,
      chapterId: doc.chapterId,
    }),
  );

/**
 * {@link TaxonomyStore} over the shared Eduents bank's dictionary collections, using raw Mongo commands
 * on the shared connection (these have no Prisma model here, so — like the bank/exam-access stores —
 * this never touches their schema or indexes). Every write sets `createdAt`/`updatedAt` explicitly,
 * because raw commands bypass Prisma's `@default(now())`/`@updatedAt`, and eduents reads those columns
 * as required `DateTime`s. Keys/scopes are validated by the service before they arrive here.
 */
export class MongoTaxonomyStore implements TaxonomyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly questionCollection = 'Question',
  ) {}

  async list(dimension: TaxonomyDimension, filter: DictionaryFilter): Promise<DictionaryRow[]> {
    const match: Record<string, unknown> = {};
    if (filter.q) match.name = { $regex: escapeRegex(filter.q), $options: 'i' };
    if ((dimension === 'chapter' || dimension === 'module') && filter.subjectId && OBJECT_ID.test(filter.subjectId)) {
      match.subjectId = { $oid: filter.subjectId };
    }
    if (dimension === 'topic' && filter.chapterId && OBJECT_ID.test(filter.chapterId)) {
      match.chapterId = { $oid: filter.chapterId };
    }
    const sort = dimension === 'level' ? { rank: 1 as const } : { name: 1 as const };
    return this.readMany(dimension, match, sort, MAX_ENTRIES);
  }

  findByKey(dimension: TaxonomyDimension, key: string): Promise<DictionaryRow | null> {
    return this.readOne(dimension, { key });
  }

  findById(dimension: TaxonomyDimension, id: string): Promise<DictionaryRow | null> {
    if (!OBJECT_ID.test(id)) return Promise.resolve(null);
    return this.readOne(dimension, { _id: { $oid: id } });
  }

  async create(dimension: TaxonomyDimension, row: NewDictionaryRow): Promise<DictionaryRow> {
    const now = { $date: new Date().toISOString() };
    const doc: Record<string, unknown> = {
      key: row.key,
      name: row.name,
      aliases: row.aliases,
      createdAt: now,
      updatedAt: now,
    };
    if (row.kind !== null) doc.kind = row.kind;
    if (row.rank !== null) doc.rank = row.rank;
    if (row.subjectId !== null) doc.subjectId = { $oid: row.subjectId };
    if (row.chapterId !== null) doc.chapterId = { $oid: row.chapterId };

    const command = { insert: COLLECTION[dimension], documents: [doc] } as unknown as Prisma.InputJsonObject;
    const reply = (await this.prisma.$runCommandRaw(command)) as Record<string, unknown>;
    const writeErrors = z
      .array(z.object({ code: ejsonNumber.catch(0) }))
      .catch([])
      .parse(reply.writeErrors ?? []);
    if (writeErrors.some((e) => e.code === 11000)) throw errors.dictionaryEntryExists(dimension, row.name);
    if (writeErrors.length > 0) throw errors.dictionaryWriteFailed('insert rejected');

    const created = await this.findByKey(dimension, row.key);
    if (!created) throw errors.dictionaryWriteFailed('entry not found after insert');
    return created;
  }

  async update(dimension: TaxonomyDimension, id: string, patch: DictionaryPatch): Promise<DictionaryRow> {
    if (!OBJECT_ID.test(id)) throw errors.dictionaryEntryNotFound(dimension, id);

    const set: Record<string, unknown> = { updatedAt: { $date: new Date().toISOString() } };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.aliases !== undefined) set.aliases = patch.aliases;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.rank !== undefined) set.rank = patch.rank;
    if (patch.subjectId !== undefined) set.subjectId = patch.subjectId === null ? null : { $oid: patch.subjectId };
    if (patch.chapterId !== undefined) set.chapterId = patch.chapterId === null ? null : { $oid: patch.chapterId };

    const command = {
      update: COLLECTION[dimension],
      updates: [{ q: { _id: { $oid: id } }, u: { $set: set } }],
    } as unknown as Prisma.InputJsonObject;
    const reply = (await this.prisma.$runCommandRaw(command)) as Record<string, unknown>;
    const matched = ejsonNumber.catch(0).parse(reply.n ?? 0);
    if (matched === 0) throw errors.dictionaryEntryNotFound(dimension, id);

    const updated = await this.findById(dimension, id);
    if (!updated) throw errors.dictionaryEntryNotFound(dimension, id);
    return updated;
  }

  async remove(dimension: TaxonomyDimension, id: string): Promise<void> {
    if (!OBJECT_ID.test(id)) throw errors.dictionaryEntryNotFound(dimension, id);
    const command = {
      delete: COLLECTION[dimension],
      deletes: [{ q: { _id: { $oid: id } }, limit: 1 }],
    } as unknown as Prisma.InputJsonObject;
    await this.prisma.$runCommandRaw(command);
  }

  async usageCounts(dimension: TaxonomyDimension, ids: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const validIds = ids.filter((id) => OBJECT_ID.test(id));
    if (validIds.length === 0) return counts;

    const fk = QUESTION_FK[dimension];
    const command = {
      aggregate: this.questionCollection,
      pipeline: [
        { $match: { [fk]: { $in: validIds.map((id) => ({ $oid: id })) } } },
        { $group: { _id: `$${fk}`, c: { $sum: 1 } } },
      ],
      cursor: { batchSize: validIds.length + 1 },
    } as unknown as Prisma.InputJsonObject;

    for (const raw of firstBatch(await this.prisma.$runCommandRaw(command))) {
      const parsed = z.object({ _id: oid, c: ejsonNumber.catch(0) }).safeParse(raw);
      if (parsed.success) counts.set(parsed.data._id, parsed.data.c);
    }
    return counts;
  }

  private async readOne(dimension: TaxonomyDimension, filter: Record<string, unknown>): Promise<DictionaryRow | null> {
    const [row] = await this.readMany(dimension, filter, undefined, 1);
    return row ?? null;
  }

  private async readMany(
    dimension: TaxonomyDimension,
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1> | undefined,
    limit: number,
  ): Promise<DictionaryRow[]> {
    // batchSize >= limit so the whole (already-bounded) result lands in `firstBatch` — Prisma's
    // `$runCommandRaw` never issues getMore, so an unset batchSize would cap this at Mongo's default 101.
    const command = {
      find: COLLECTION[dimension],
      filter,
      ...(sort ? { sort } : {}),
      limit,
      batchSize: limit,
    } as unknown as Prisma.InputJsonObject;

    const out: DictionaryRow[] = [];
    for (const raw of firstBatch(await this.prisma.$runCommandRaw(command))) {
      const parsed = RawDictSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }
}
