import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_FILLABLE_FIELDS, AiFilledSchema, MatchDataSchema, type AiFilledSummary, type MatchData } from '@ingest/contracts';
import type { AuditQuestion, QuestionAuditSource } from '../../modules/quality/index.js';
import { ejsonBool, ejsonNumber, firstBatch, objectIdDate, oid } from '../database/mongo-ejson.js';

const count = ejsonNumber.catch(0);

/** The one row the AI-filled aggregation groups into. */
const AiFilledCountsSchema = z.object({
  questions: count,
  topic: count,
  answer: count,
  solution: count,
  level: count,
  structure: count,
});

const nullableText = z.string().nullable().catch(null);

/** Non-empty strings out of a raw array column; anything else in it is dropped. */
const textList = z
  .array(z.unknown())
  .catch([])
  .transform((items) => items.filter((item): item is string => typeof item === 'string' && item.trim() !== ''));

/** The bank stores the matching in two columns; a malformed pair degrades to null, never to a half table. */
function toMatch(columns: unknown, key: unknown): MatchData | null {
  if (columns === null || columns === undefined) return null;
  const parsed = MatchDataSchema.safeParse({ columns, key: key ?? {} });
  return parsed.success ? parsed.data : null;
}

const MatchColumnsSchema = z
  .array(
    z.object({
      title: z.string().catch(''),
      entries: z.array(z.object({ body: z.string().catch('') }).catch({ body: '' })).catch([]),
    }),
  )
  .nullable()
  .catch(null);

/**
 * Parser for one raw bank `Question` document → {@link AuditQuestion}. Every column is tolerant because
 * the collection predates this app and legacy rows omit most of it: a malformed column degrades to its
 * empty value so the row is still audited (an absent value is itself something the rules report).
 */
const RawAuditQuestionSchema = z.object({
  _id: oid,
  question_number: ejsonNumber.nullable().catch(null),
  file_name: nullableText,
  question_text: z.string().catch(''),
  answer: nullableText,
  explanation: nullableText,
  options: z.array(z.unknown()).catch([]).transform((items) => items.map((item) => (typeof item === 'string' ? item : ''))),
  isQuestionImage: ejsonBool.catch(false),
  question_image: nullableText,
  isOptionImage: ejsonBool.catch(false),
  option_images: textList,
  passage: nullableText,
  passage_image: nullableText,
  group_id: nullableText,
  // Kept raw: the same column feeds both the rules' reduced view and the full table (with the key).
  match_columns: z.unknown(),
  match_key: z.unknown(),
  question_type: nullableText,
  level: nullableText,
  topic: nullableText,
  exam_name: nullableText,
  subject: nullableText,
  chapter: nullableText,
  section_name: nullableText,
  // A malformed tag is dropped whole rather than half-trusted.
  ai_filled: AiFilledSchema.catch({}),
  ingest_ref: z.object({ question_id: z.string(), document_id: z.string() }).nullable().catch(null),
});

function toAuditQuestion(raw: unknown): AuditQuestion | null {
  const parsed = RawAuditQuestionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data;
  return {
    id: doc._id,
    ingestQuestionId: doc.ingest_ref?.question_id ?? null,
    documentId: doc.ingest_ref?.document_id ?? null,
    questionNumber: doc.question_number,
    fileName: doc.file_name,
    addedAt: objectIdDate(doc._id)?.toISOString() ?? null,
    questionText: doc.question_text,
    answer: doc.answer,
    explanation: doc.explanation,
    options: doc.options,
    isQuestionImage: doc.isQuestionImage,
    questionImage: doc.question_image,
    isOptionImage: doc.isOptionImage,
    optionImages: doc.option_images,
    passage: doc.passage,
    passageImage: doc.passage_image,
    groupId: doc.group_id,
    matchColumns: MatchColumnsSchema.parse(doc.match_columns),
    match: toMatch(doc.match_columns, doc.match_key),
    questionType: doc.question_type,
    level: doc.level,
    topic: doc.topic,
    exam: doc.exam_name,
    subject: doc.subject,
    chapter: doc.chapter,
    section: doc.section_name,
    aiFilled: doc.ai_filled,
  };
}

/**
 * Only the rows Eduents serves from the shared bank. Its tenancy read filter is `{ organizationId: null }`
 * evaluated so that a row matches only when the field EXISTS and is null (see the publish service), which
 * `$type: 'null'` states exactly — a plain `null` match here would also pull in rows missing the field,
 * which no organisation can see. Organisation-private questions (a real organizationId) are excluded too.
 */
const LIVE_SHARED_BANK = { organizationId: { $type: 'null' } };

/**
 * {@link QuestionAuditSource} over the LIVE shared rows of the main bank's `Question` collection, read with
 * raw `find` commands on the shared connection (the bank has no Prisma model). Ingest staging is never
 * read. Walks the rows in `_id` order with an id-cursor so each batch is one bounded round-trip. Read-only.
 */
export class MongoQuestionAuditSource implements QuestionAuditSource {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async findById(questionId: string): Promise<AuditQuestion | null> {
    if (!/^[a-f\d]{24}$/i.test(questionId)) return null;
    const command = {
      find: this.collection,
      filter: { ...LIVE_SHARED_BANK, _id: { $oid: questionId } },
      limit: 1,
    } as unknown as Prisma.InputJsonObject;
    const [row] = firstBatch(await this.prisma.$runCommandRaw(command));
    return row === undefined ? null : toAuditQuestion(row);
  }

  async findByIds(questionIds: string[]): Promise<AuditQuestion[]> {
    const ids = questionIds.filter((id) => /^[a-f\d]{24}$/i.test(id));
    if (ids.length === 0) return [];
    const command = {
      find: this.collection,
      filter: { ...LIVE_SHARED_BANK, _id: { $in: ids.map((id) => ({ $oid: id })) } },
      limit: ids.length,
      batchSize: ids.length,
    } as unknown as Prisma.InputJsonObject;
    return firstBatch(await this.prisma.$runCommandRaw(command))
      .map(toAuditQuestion)
      .filter((question): question is AuditQuestion => question !== null);
  }

  async aiFilledSummary(): Promise<AiFilledSummary> {
    /** 1 when the row carries a tag for this field, else 0. */
    const has = (field: string): unknown => ({ $cond: [{ $ne: [{ $type: `$ai_filled.${field}` }, 'missing'] }, 1, 0] });
    const command = {
      aggregate: this.collection,
      pipeline: [
        { $match: { ...LIVE_SHARED_BANK, ai_filled: { $type: 'object' } } },
        { $project: Object.fromEntries(AI_FILLABLE_FIELDS.map((field) => [field, has(field)])) },
        {
          $group: {
            _id: null,
            questions: { $sum: { $cond: [{ $gt: [{ $add: AI_FILLABLE_FIELDS.map((field) => `$${field}`) }, 0] }, 1, 0] } },
            ...Object.fromEntries(AI_FILLABLE_FIELDS.map((field) => [field, { $sum: `$${field}` }])),
          },
        },
      ],
      cursor: {},
    } as unknown as Prisma.InputJsonObject;
    const [row] = firstBatch(await this.prisma.$runCommandRaw(command));
    const empty = { questions: 0, topic: 0, answer: 0, solution: 0, level: 0, structure: 0 };
    const counts = AiFilledCountsSchema.catch(empty).parse(row ?? {});
    return {
      questions: counts.questions,
      byField: {
        topic: counts.topic,
        answer: counts.answer,
        solution: counts.solution,
        level: counts.level,
        structure: counts.structure,
      },
    };
  }

  async *batches(batchSize: number): AsyncIterable<AuditQuestion[]> {
    let after: string | null = null;
    for (;;) {
      const command = {
        find: this.collection,
        filter: after ? { ...LIVE_SHARED_BANK, _id: { $gt: { $oid: after } } } : LIVE_SHARED_BANK,
        sort: { _id: 1 },
        limit: batchSize,
        // Without an explicit batchSize the server returns only 101 documents in `firstBatch` (the rest
        // would need getMore), which would silently truncate every batch.
        batchSize,
        projection: { createdById: 0 },
      } as unknown as Prisma.InputJsonObject;
      const rows = firstBatch(await this.prisma.$runCommandRaw(command));
      if (rows.length === 0) return;
      const lastId = oid.safeParse((rows[rows.length - 1] as { _id?: unknown } | undefined)?._id);
      yield rows.map(toAuditQuestion).filter((question): question is AuditQuestion => question !== null);
      // Continue until an empty page rather than trusting a short one, so a server-side cap can never end
      // the walk early.
      if (!lastId.success) return;
      after = lastId.data;
    }
  }
}
