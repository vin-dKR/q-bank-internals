import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AiFilledSchema, aiFilledFields, withoutAiFields, type AiFillableField, type BankQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { ejsonBool, ejsonNumber, escapeRegex, firstBatch, oid } from '../database/mongo-ejson.js';
import type { BankImagePatch, BankQuestionStore, BankTextPatch } from '../../modules/bank/index.js';

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

/** Just what a text edit needs to decide whether it overwrites an AI-filled value. */
const RawAiFilledRowSchema = z.object({
  answer: z.string().nullable().catch(null),
  explanation: z.string().nullable().catch(null),
  ai_filled: AiFilledSchema.catch({}),
});

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

  async setFlag(id: string, flagged: boolean): Promise<boolean> {
    const command = {
      update: this.collection,
      updates: [{ q: { _id: { $oid: id } }, u: { $set: { flagged } } }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    // `$runCommandRaw` returns Extended JSON; the matched count `n` may be a plain or wrapped number.
    const matched = ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
    if (matched === 0) throw errors.bankQuestionNotFound(id);
    return flagged;
  }

  async setText(id: string, patch: BankTextPatch): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.questionText !== undefined) set.question_text = patch.questionText;
    if (patch.options !== undefined) set.options = patch.options;
    if (patch.answer !== undefined) set.answer = patch.answer;
    if (patch.explanation !== undefined) set.explanation = patch.explanation;
    // The match table splits across two bank columns (the read/publish shape); clearing it nulls both.
    if (patch.match !== undefined) {
      set.match_columns = patch.match ? patch.match.columns : null;
      set.match_key = patch.match ? patch.match.key : null;
    }
    // Before the command is built: it may add the reduced tag set to `set`.
    const unset = await this.untagEdited(id, patch, set);
    const command = {
      update: this.collection,
      updates: [{ q: { _id: { $oid: id } }, u: { $set: set, ...unset } }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    const matched = ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
    if (matched === 0) throw errors.bankQuestionNotFound(id);
  }

  /**
   * A hand edit to an AI-filled answer, explanation or match table makes it a human's value, so its
   * `ai_filled` tag must go. Adds the new tag set to `set` (or returns an `$unset` when none remain); no-op when nothing tagged
   * actually changes.
   */
  private async untagEdited(id: string, patch: BankTextPatch, set: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (patch.answer === undefined && patch.explanation === undefined && patch.match === undefined) return {};
    const command = {
      find: this.collection,
      filter: { _id: { $oid: id } },
      projection: { answer: 1, explanation: 1, ai_filled: 1 },
      limit: 1,
    } as unknown as Prisma.InputJsonObject;
    const row = RawAiFilledRowSchema.safeParse(firstBatch(await this.prisma.$runCommandRaw(command))[0]);
    if (!row.success) return {};
    const { ai_filled: filled } = row.data;
    const drop: AiFillableField[] = [];
    if (patch.answer !== undefined && patch.answer !== row.data.answer && filled.answer) drop.push('answer');
    if (patch.explanation !== undefined && patch.explanation !== row.data.explanation && filled.solution) drop.push('solution');
    // The browse card sends the match table only when the operator changed it, so its presence IS the edit.
    if (patch.match !== undefined && filled.structure) drop.push('structure');
    if (drop.length === 0) return {};
    const next = withoutAiFields(filled, drop);
    if (aiFilledFields(next).length === 0) return { $unset: { ai_filled: '' } };
    set.ai_filled = next;
    return {};
  }

  async setPassage(groupId: string, passage: string): Promise<number> {
    // multi:true — the passage is denormalized onto every sibling row, so all of the group's rows are
    // rewritten in one command. `n` is the matched count (may arrive as a wrapped Extended-JSON number).
    const command = {
      update: this.collection,
      updates: [{ q: { group_id: groupId }, u: { $set: { passage } }, multi: true }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    const matched = ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
    if (matched === 0) throw errors.bankGroupNotFound(groupId);
    return matched;
  }

  async deleteByQuestionId(questionId: string): Promise<number> {
    // limit 0 = delete every row matching the ingest question id (guards against any historical
    // duplicate before this key was unique); the count `n` may arrive as a wrapped Extended-JSON number.
    const command = {
      delete: this.collection,
      deletes: [{ q: byQuestionId(questionId), limit: 0 }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    return ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
  }

  async deleteById(id: string): Promise<void> {
    // Target the single row by its bank `_id` (limit 1). Like setFlag/setText, `n` may be a plain or
    // wrapped Extended-JSON number; a zero match means the id no longer exists — surface it, don't swallow.
    const command = {
      delete: this.collection,
      deletes: [{ q: { _id: { $oid: id } }, limit: 1 }],
    } as unknown as Prisma.InputJsonObject;
    const reply = await this.prisma.$runCommandRaw(command);
    const removed = ejsonNumber.catch(0).parse((reply as Record<string, unknown>).n ?? 0);
    if (removed === 0) throw errors.bankQuestionNotFound(id);
  }

  /** Pull the `cursor.firstBatch` out of a raw `find` reply and parse each document, dropping junk. */
  private readBatch(result: unknown): BankQuestion[] {
    const questions: BankQuestion[] = [];
    for (const item of firstBatch(result)) {
      const parsed = RawBankQuestionSchema.safeParse(item);
      if (parsed.success) questions.push(parsed.data);
    }
    return questions;
  }
}
