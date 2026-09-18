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
 * bank read/fix store uses), so re-publishing a document overwrites its rows instead of appending
 * duplicates. The reply is inspected for `writeErrors` / `writeConcernError` and for a short match
 * count — a partial or failed write throws instead of silently returning fewer rows than sent.
 */
export class MongoBankPublisher implements BankPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async upsertQuestions(questions: BankQuestion[]): Promise<number> {
    if (questions.length === 0) return 0;
    const command = {
      update: this.collection,
      updates: questions.map((question) => ({
        q: { [INGEST_QUESTION_ID_PATH]: ingestQuestionId(question) },
        u: withObjectIdFks(question),
        upsert: true,
      })),
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
        `${String(reply.writeErrors.length)} of ${String(questions.length)} rows failed (${detail}).`,
      );
    }
    if (reply.n < questions.length) {
      throw errors.publishWriteFailed(
        `only ${String(reply.n)} of ${String(questions.length)} rows were written.`,
      );
    }
    return reply.n;
  }
}
