import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { BankQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { BankImagePatch, BankQuestionStore } from '../../modules/bank/index.js';

/** Escape user text so it is matched as a literal substring by `$regex`, never as a pattern. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `$runCommandRaw` returns extended JSON: numbers may be wrapped as `{ $numberInt: "1" }` etc. */
const ejsonNumber = z.preprocess((value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const raw = record.$numberInt ?? record.$numberLong ?? record.$numberDouble;
    if (typeof raw === 'string') return Number(raw);
  }
  return value;
}, z.number());

/** Booleans stored as 1/"true"/true all mean true; anything else is false. */
const ejsonBool = z.preprocess(
  (value) => value === true || value === 1 || value === '1' || value === 'true',
  z.boolean(),
);

/** The Mongo `_id` comes back as `{ $oid: "…" }`; unwrap it to the hex string. */
const oid = z.preprocess((value) => {
  if (value && typeof value === 'object') {
    const hex = (value as Record<string, unknown>).$oid;
    if (typeof hex === 'string') return hex;
  }
  return value;
}, z.string());

const RawIngestRefSchema = z
  .object({
    session_id: z.string().nullable().catch(null),
    document_id: z.string(),
    question_id: z.string(),
    drive_file_id: z.string(),
    source_region: z.object({
      page: ejsonNumber,
      bbox: z.tuple([ejsonNumber, ejsonNumber, ejsonNumber, ejsonNumber]),
    }),
  })
  .transform((ref) => ({
    sessionId: ref.session_id,
    documentId: ref.document_id,
    questionId: ref.question_id,
    driveFileId: ref.drive_file_id,
    sourceRegion: { page: ref.source_region.page, bbox: ref.source_region.bbox },
  }));

/**
 * Parser for one raw bank `Question` document → the shared {@link BankQuestion} shape. Every field is
 * tolerant (`.catch`) because the collection predates this app and legacy rows omit most of it; a
 * malformed `ingest_ref` degrades to null (found, but not auto-fixable) rather than dropping the row.
 */
const RawBankQuestionSchema = z
  .object({
    _id: oid,
    file_name: z.string().nullable().catch(null),
    question_text: z.string().catch(''),
    exam_name: z.string().nullable().catch(null),
    subject: z.string().nullable().catch(null),
    chapter: z.string().nullable().catch(null),
    options: z.array(z.string()).catch([]),
    isQuestionImage: ejsonBool.catch(false),
    question_image: z.string().nullable().catch(null),
    isOptionImage: ejsonBool.catch(false),
    option_images: z.array(z.string()).catch([]),
    ingest_ref: RawIngestRefSchema.nullable().catch(null),
  })
  .transform(
    (doc): BankQuestion => ({
      id: doc._id,
      fileName: doc.file_name,
      questionText: doc.question_text,
      exam: doc.exam_name,
      subject: doc.subject,
      chapter: doc.chapter,
      options: doc.options,
      isQuestionImage: doc.isQuestionImage,
      questionImage: doc.question_image,
      isOptionImage: doc.isOptionImage,
      optionImages: doc.option_images,
      ingestRef: doc.ingest_ref,
    }),
  );

/** The `_id` filter that targets a published row by the ingest question id stamped on `ingest_ref`. */
function byQuestionId(questionId: string): Record<string, unknown> {
  return { 'ingest_ref.question_id': questionId };
}

/**
 * {@link BankQuestionStore} over the main bank's `Question` collection, using raw Mongo commands on
 * the shared connection (the bank has no Prisma model, so — like {@link MongoBankPublisher} — this
 * never touches its schema or indexes). Rows are keyed for fixing by `ingest_ref.question_id`.
 */
export class MongoBankQuestionStore implements BankQuestionStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async search(text: string, limit: number): Promise<BankQuestion[]> {
    const pattern = escapeRegex(text);
    const command = {
      find: this.collection,
      filter: {
        $or: [
          { question_text: { $regex: pattern, $options: 'i' } },
          { file_name: { $regex: pattern, $options: 'i' } },
        ],
      },
      limit,
    } as unknown as Prisma.InputJsonObject;
    return this.readBatch(await this.prisma.$runCommandRaw(command));
  }

  async findByQuestionId(questionId: string): Promise<BankQuestion | null> {
    const command = {
      find: this.collection,
      filter: byQuestionId(questionId),
      limit: 1,
    } as unknown as Prisma.InputJsonObject;
    return this.readBatch(await this.prisma.$runCommandRaw(command))[0] ?? null;
  }

  async patchImages(questionId: string, patch: BankImagePatch): Promise<BankQuestion> {
    const set: Record<string, unknown> = {};
    if (patch.isQuestionImage !== undefined) set.isQuestionImage = patch.isQuestionImage;
    if (patch.questionImage !== undefined) set.question_image = patch.questionImage;
    if (patch.isOptionImage !== undefined) set.isOptionImage = patch.isOptionImage;
    if (patch.optionImages !== undefined) set.option_images = patch.optionImages;
    const command = {
      update: this.collection,
      updates: [{ q: byQuestionId(questionId), u: { $set: set } }],
    } as unknown as Prisma.InputJsonObject;
    await this.prisma.$runCommandRaw(command);
    const updated = await this.findByQuestionId(questionId);
    if (!updated) throw errors.bankQuestionNotFound(questionId);
    return updated;
  }

  /** Pull the `cursor.firstBatch` out of a raw `find` reply and parse each document, dropping junk. */
  private readBatch(result: unknown): BankQuestion[] {
    const cursor = (result as { cursor?: { firstBatch?: unknown } }).cursor;
    const batch = cursor?.firstBatch;
    if (!Array.isArray(batch)) return [];
    const questions: BankQuestion[] = [];
    for (const item of batch) {
      const parsed = RawBankQuestionSchema.safeParse(item);
      if (parsed.success) questions.push(parsed.data);
    }
    return questions;
  }
}
