import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { aiFilledFields, type AiFilled, type QuestionFix } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { answerLabels, optionBody, optionLabel } from '../../modules/quality/index.js';
import type { QuestionFixStore, QuestionFixWrite } from '../../modules/quality/index.js';
import { firstBatch } from '../database/mongo-ejson.js';

/** Writes per raw command. */
const WRITE_CHUNK = 500;

/** Bank column for each editable field (the bank stores snake_case; the contract is camelCase). */
const BANK_COLUMN: Record<keyof QuestionFix, string> = {
  questionText: 'question_text',
  options: 'options',
  answer: 'answer',
  explanation: 'explanation',
  topic: 'topic',
  subject: 'subject',
  chapter: 'chapter',
  exam: 'exam_name',
  questionType: 'question_type',
  sectionName: 'section_name',
  level: 'level',
  // Structure: a match table is split across two bank columns (see `bankSet`), and the shared passage is
  // written to every row of the group (see `writeBank`).
  match: 'match_columns',
  passage: 'passage',
};

/**
 * Staging (`ingest_extracted_questions`) field for each editable field. `chapter` and `exam` are absent on
 * purpose: in staging they live on the parent document, not the question, and publish stamps them from
 * there — so correcting them on one question must not rewrite the whole chapter's source of truth.
 * `options` is handled separately: staging stores structured options, the bank flat strings.
 */
const STAGING_FIELD: Partial<Record<keyof QuestionFix, string>> = {
  questionText: 'stem',
  // Staging keeps the whole table in one Json field; its passage lives in a collection of its own, written
  // separately by `writeStagingPassages`.
  match: 'match',
  answer: 'answer',
  explanation: 'explanation',
  topic: 'topic',
  subject: 'subject',
  questionType: 'questionType',
  sectionName: 'sectionName',
  level: 'level',
};

const UpdateReplySchema = z.object({
  writeErrors: z.array(z.object({ errmsg: z.string().catch('') })).catch([]),
});

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/** The bank `$set` document for one fix. */
function bankSet(fix: QuestionFix): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fix)) {
    if (field === 'match') continue;
    const column = BANK_COLUMN[field as keyof QuestionFix];
    set[column] = value;
  }
  // The bank reads the matching back from two columns, so it is written as two.
  if (fix.match !== undefined) {
    set.match_columns = fix.match ? fix.match.columns : null;
    set.match_key = fix.match ? fix.match.key : null;
  }
  return set;
}

/**
 * The update document for one write: the field `$set`, plus the AI-filled tags under `column` when the write
 * carries them — replaced whole, or removed when none remain, so a stale per-field tag can never survive.
 */
function updateDoc(set: Record<string, unknown>, aiFilled: AiFilled | undefined, column: string): Record<string, unknown> {
  if (aiFilled === undefined) return { $set: set };
  if (aiFilledFields(aiFilled).length === 0) return { $set: set, $unset: { [column]: '' } };
  return { $set: { ...set, [column]: aiFilled } };
}

/**
 * Split a bank option string back into the structured shape staging keeps: "(A) body" → label "A", body
 * "body". `isCorrect` is re-derived from the answer being saved (falling back to the labels already in the
 * fix), because the two must agree — staging's verify screen reads the flag, the bank reads the string.
 */
function stagingOptions(options: string[], answer: string | null | undefined): unknown[] {
  const correct = new Set(answer ? answerLabels(answer) : []);
  return options.map((option, index) => {
    const label = optionLabel(option) ?? String.fromCharCode('A'.charCodeAt(0) + index);
    return { label: label.toUpperCase(), body: optionBody(option), isCorrect: correct.has(label.toLowerCase()) };
  });
}

/**
 * The staging `$set` for one fix, or null when the fix touches nothing staging owns.
 *
 * Options need care: staging marks the right option with `isCorrect`, which the bank does not store. When
 * the fix carries an answer, the flags are re-derived from it. When it does not (an option's TEXT was
 * corrected, say), the flags must be PRESERVED — so each option's label and body are set in place and the
 * flag left alone. That in-place write is only safe while the two lists are the same length, which
 * `stagedCount` reports; otherwise the array is rewritten and the flags come from the answer staging
 * already holds.
 */
function stagingSet(fix: QuestionFix, staged: StagedOptions | undefined): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fix)) {
    const target = STAGING_FIELD[field as keyof QuestionFix];
    if (target) set[target] = value;
  }
  if (fix.options) {
    if (fix.answer !== undefined) set.options = stagingOptions(fix.options, fix.answer);
    else if (staged && staged.count === fix.options.length) {
      fix.options.forEach((option, index) => {
        const label = optionLabel(option) ?? String.fromCharCode('A'.charCodeAt(0) + index);
        set[`options.${String(index)}.label`] = label.toUpperCase();
        set[`options.${String(index)}.body`] = optionBody(option);
      });
    } else set.options = stagingOptions(fix.options, staged?.answer ?? null);
  }
  if (Object.keys(set).length === 0) return null;
  // Raw commands bypass Prisma's `@updatedAt`, so the staging row would otherwise look untouched.
  set.updatedAt = { $date: new Date().toISOString() };
  return set;
}

/** What staging already holds for a question whose options are being rewritten without an answer. */
type StagedOptions = { count: number; answer: string | null };

/** The staging row's link to its shared passage, for a fix that rewrites that passage. */
const StagedPassageSchema = z.object({
  _id: z.object({ $oid: z.string() }),
  passageId: z.string().nullable().catch(null),
});

const StagedOptionsSchema = z.object({
  _id: z.object({ $oid: z.string() }),
  answer: z.string().nullable().catch(null),
  options: z.array(z.unknown()).catch([]),
});


/**
 * {@link QuestionFixStore} over the main bank's `Question` collection and the ingest staging collection,
 * using raw Mongo commands on the shared connection (the bank has no Prisma model).
 *
 * Both are written because publishing REPLACES a bank row with its staging copy: correcting only the bank
 * would be silently undone the next time that document is re-published. A legacy question (no
 * `ingest_ref`) has no staging copy, so only the bank row is written.
 */
export class MongoQuestionFixStore implements QuestionFixStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
    private readonly stagingCollection = 'ingest_extracted_questions',
    private readonly stagingPassageCollection = 'ingest_passages',
  ) {}

  async apply(fix: QuestionFixWrite): Promise<void> {
    await this.applyMany([fix]);
  }

  async applyMany(fixes: QuestionFixWrite[]): Promise<number> {
    let written = 0;
    for (const batch of chunk(fixes, WRITE_CHUNK)) {
      written += await this.writeBank(batch);
      const staged = batch.filter((write) => write.ingestQuestionId !== null);
      if (staged.length > 0) {
        await this.writeStaging(staged);
        await this.writeStagingPassages(staged);
      }
    }
    return written;
  }

  private async writeBank(fixes: QuestionFixWrite[]): Promise<number> {
    const command = {
      update: this.collection,
      updates: [
        ...fixes.map((write) => ({
          q: { _id: { $oid: write.questionId } },
          u: updateDoc({ ...bankSet(write.fix), ...write.bankTaxonomy }, write.aiFilled, 'ai_filled'),
        })),
        // A comprehension passage is denormalized onto every row of its group, so correcting it on one row
        // would leave the siblings showing the old text. Written to the whole group, in the same command.
        ...fixes.flatMap((write) =>
          write.fix.passage !== undefined && write.groupId
            ? [{ q: { group_id: write.groupId }, u: { $set: { passage: write.fix.passage } }, multi: true }]
            : [],
        ),
      ],
      ordered: false,
    } as unknown as Prisma.InputJsonObject;
    const reply = UpdateReplySchema.parse(await this.prisma.$runCommandRaw(command));
    const [first] = reply.writeErrors;
    if (first) {
      throw errors.qualityWriteFailed(`${String(reply.writeErrors.length)} question writes failed (${first.errmsg}).`);
    }
    return fixes.length;
  }

  private async writeStaging(fixes: QuestionFixWrite[]): Promise<void> {
    const staged = await this.readStagedOptions(fixes);
    const updates = fixes.flatMap((write) => {
      const set = stagingSet(write.fix, write.ingestQuestionId ? staged.get(write.ingestQuestionId) : undefined);
      // `ingestQuestionId` is non-null here: applyMany filters the batch before calling.
      return set && write.ingestQuestionId
        ? [{ q: { _id: { $oid: write.ingestQuestionId } }, u: updateDoc(set, write.aiFilled, 'aiFilled') }]
        : [];
    });
    if (updates.length === 0) return;
    const command = {
      update: this.stagingCollection,
      updates,
      ordered: false,
    } as unknown as Prisma.InputJsonObject;
    const reply = UpdateReplySchema.parse(await this.prisma.$runCommandRaw(command));
    const [first] = reply.writeErrors;
    if (first) {
      throw errors.qualityWriteFailed(
        `the bank was corrected but ${String(reply.writeErrors.length)} staging copies were not (${first.errmsg}). ` +
          'Re-publishing those documents would undo the correction.',
      );
    }
  }

  /**
   * The staging side of a passage fix: staging normalizes the passage into its own collection, so the text is
   * written there (once per group), not onto the question rows. A question with no passage row is skipped.
   */
  private async writeStagingPassages(fixes: QuestionFixWrite[]): Promise<void> {
    const wanted = fixes.filter((write) => write.fix.passage !== undefined && write.ingestQuestionId !== null);
    if (wanted.length === 0) return;
    const findCommand = {
      find: this.stagingCollection,
      filter: { _id: { $in: wanted.map((write) => ({ $oid: write.ingestQuestionId ?? '' })) } },
      projection: { passageId: 1 },
      batchSize: wanted.length,
    } as unknown as Prisma.InputJsonObject;
    const passageByQuestion = new Map<string, string>();
    for (const row of firstBatch(await this.prisma.$runCommandRaw(findCommand))) {
      const parsed = StagedPassageSchema.safeParse(row);
      if (parsed.success && parsed.data.passageId) passageByQuestion.set(parsed.data._id.$oid, parsed.data.passageId);
    }
    const updates = wanted.flatMap((write) => {
      const passageId = passageByQuestion.get(write.ingestQuestionId ?? '');
      return passageId === undefined
        ? []
        : [{
            q: { _id: passageId },
            u: { $set: { text: write.fix.passage, updatedAt: { $date: new Date().toISOString() } } },
          }];
    });
    if (updates.length === 0) return;
    const command = { update: this.stagingPassageCollection, updates, ordered: false } as unknown as Prisma.InputJsonObject;
    const reply = UpdateReplySchema.parse(await this.prisma.$runCommandRaw(command));
    const [first] = reply.writeErrors;
    if (first) {
      throw errors.qualityWriteFailed(
        `the bank was corrected but ${String(reply.writeErrors.length)} staging passages were not (${first.errmsg}). ` +
          'Re-publishing those documents would undo the correction.',
      );
    }
  }

  /**
   * One read for the whole batch: what staging currently holds for questions whose options are being
   * rewritten without an answer — the only case where the existing `isCorrect` flags must be respected.
   */
  private async readStagedOptions(fixes: QuestionFixWrite[]): Promise<Map<string, StagedOptions>> {
    const ids = fixes
      .filter((write) => write.fix.options !== undefined && write.fix.answer === undefined)
      .map((write) => write.ingestQuestionId)
      .filter((id): id is string => id !== null);
    if (ids.length === 0) return new Map();
    const command = {
      find: this.stagingCollection,
      filter: { _id: { $in: ids.map((id) => ({ $oid: id })) } },
      projection: { answer: 1, options: 1 },
      batchSize: ids.length,
    } as unknown as Prisma.InputJsonObject;
    const rows = firstBatch(await this.prisma.$runCommandRaw(command));
    const staged = new Map<string, StagedOptions>();
    for (const row of rows) {
      const parsed = StagedOptionsSchema.safeParse(row);
      if (parsed.success) {
        staged.set(parsed.data._id.$oid, { count: parsed.data.options.length, answer: parsed.data.answer });
      }
    }
    return staged;
  }
}
