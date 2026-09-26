import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { errors } from '../../shared/errors/error-catalog.js';
import { ejsonNumber } from '../database/mongo-ejson.js';
import type { BankPublisher, BankQuestion } from '../../modules/publish/index.js';

/** The `ingest_ref.question_id` a published row carries — the idempotency key for re-publishing. */
const INGEST_QUESTION_ID_PATH = 'ingest_ref.question_id';

/**
 * Bank `Question` columns eduents declares as `@db.ObjectId`. The publish mapper stamps them from the
 * resolver's hex-STRING ids, but `$runCommandRaw` does NOT coerce a hex string to an ObjectId — so
 * unless each is written as an Extended-JSON `{ $oid }`, the row stores a BSON string where eduents
 * (and its indexed FK filters / the masters usage counts) expect an ObjectId, and the row is either
 * unreadable or invisible to every one of those queries. `organizationId` stays null and is untouched.
 */
const OBJECT_ID_FIELDS = [
  'examId',
  'subjectId',
  'chapterId',
  'sectionId',
  'questionTypeId',
  'levelId',
  'topicId',
] as const;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Compare Extended JSON values without depending on object key order. */
function comparable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(comparable).join(',')}]`;
  const record = value as Record<string, unknown>;
  for (const key of ['$numberInt', '$numberLong', '$numberDouble']) {
    if (typeof record[key] === 'string' && Object.keys(record).length === 1) return comparable(Number(record[key]));
  }
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${comparable(record[key])}`).join(',')}}`;
}

const FindReplySchema = z.object({
  cursor: z.object({ firstBatch: z.array(z.record(z.unknown())) }),
});

/** Shallow copy with every taxonomy FK hex-string rewritten as a BSON ObjectId for the raw write. */
function withObjectIdFks(question: BankQuestion): BankQuestion {
  const out: Record<string, unknown> = { ...question };
  for (const field of OBJECT_ID_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && OBJECT_ID.test(value)) out[field] = { $oid: value };
  }
  return out;
}

/**
 * The relevant fields of a raw Mongo `update` reply (Extended JSON, so counts may arrive wrapped as
 * `{ $numberInt }`). Everything is tolerant so a shape surprise degrades to "no rows / no errors"
 * rather than throwing before the explicit reliability checks below run.
 */
const UpdateReplySchema = z.object({
  n: ejsonNumber.catch(0),
  writeErrors: z
    .array(z.object({ index: ejsonNumber.catch(0), errmsg: z.string().catch('') }))
    .catch([]),
  writeConcernError: z.object({ errmsg: z.string().catch('') }).nullable().catch(null),
});

/** Read the `ingest_ref.question_id` off a bank row, or fail loudly — it is the idempotency key. */
function ingestQuestionId(question: BankQuestion): string {
  const ref = question.ingest_ref;
  if (ref && typeof ref === 'object' && 'question_id' in ref) {
    const id = ref.question_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  throw errors.publishWriteFailed('a question is missing its ingest_ref.question_id.');
}

/**
 * {@link BankPublisher} that writes into the main bank's `Question` collection with a RAW Mongo
 * command over the shared connection. Deliberately raw (not a Prisma model) so publishing can never
 * alter the bank's schema or indexes.
 *
 * Idempotent by design: each row is an `upsert` keyed on `ingest_ref.question_id` (the same key the
 * bank read/fix store uses). Later saves patch changed fields and skip unchanged rows, retaining
 * each row's bank id and unrelated fields. The reply is inspected for errors and a short match
 * count — a partial or failed write throws instead of silently returning fewer rows than sent.
 */
export class MongoBankPublisher implements BankPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async upsertQuestions(questions: BankQuestion[]): Promise<number> {
    if (questions.length === 0) return 0;
    // Read existing rows in bounded batches before selecting changed questions.
    const existing = new Map<string, BankQuestion>();
    for (let offset = 0; offset < questions.length; offset += 100) {
      const ids = questions.slice(offset, offset + 100).map(ingestQuestionId);
      const result = FindReplySchema.parse(await this.prisma.$runCommandRaw({
        find: this.collection,
        filter: { [INGEST_QUESTION_ID_PATH]: { $in: ids } },
        batchSize: 100,
        singleBatch: true,
      } as unknown as Prisma.InputJsonObject));
      for (const row of result.cursor.firstBatch) existing.set(ingestQuestionId(row), row);
    }
    const updates = questions.flatMap((question) => {
      const id = ingestQuestionId(question);
      const previous = existing.get(id);
      const next = withObjectIdFks(question);
      const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
        !previous || comparable(previous[key]) !== comparable(value),
      ));
      // The mapper omits empty provenance. Clear an old AI tag after a human edits it.
      const unset = previous?.ai_filled !== undefined && next.ai_filled === undefined
        ? { ai_filled: '' } : {};
      if (Object.keys(changed).length === 0 && Object.keys(unset).length === 0) return [];
      return [{
        q: { [INGEST_QUESTION_ID_PATH]: id },
        u: {
          ...(Object.keys(changed).length > 0 ? { $set: changed } : {}),
          ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
        },
        // A deleted existing row must fail the match check, rather than insert an incomplete patch.
        upsert: !previous,
      }];
    });
    if (updates.length === 0) return 0;
    const command = {
      update: this.collection,
      updates,
      // Unordered: attempt every row even if one fails, so writeErrors aggregate the full picture.
      ordered: false,
    } as unknown as Prisma.InputJsonObject;

    const reply = UpdateReplySchema.parse(await this.prisma.$runCommandRaw(command));

    if (reply.writeConcernError) {
      throw errors.publishWriteFailed(reply.writeConcernError.errmsg || 'write concern not satisfied.');
    }
    if (reply.writeErrors.length > 0) {
      const detail = reply.writeErrors[0]?.errmsg ?? 'unknown write error';
      throw errors.publishWriteFailed(
        `${String(reply.writeErrors.length)} of ${String(updates.length)} rows failed (${detail}).`,
      );
    }
    if (reply.n < updates.length) {
      throw errors.publishWriteFailed(
        `only ${String(reply.n)} of ${String(updates.length)} rows were written.`,
      );
    }
    return reply.n;
  }
}
