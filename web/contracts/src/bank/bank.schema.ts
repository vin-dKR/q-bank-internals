import { z } from 'zod';
import { MatchDataSchema } from '../questions/question.schema.js';

/**
 * Back-reference stamped onto every bank Question at publish time, so a published question can be
 * traced to the exact Drive PDF + page + crop box it was read from. This is the information the
 * "fix a bad image" flow needs to reopen the source page and re-crop. Stored on the bank document
 * under `ingest_ref`; null on questions published before this reference existed.
 */
export const IngestRefSchema = z.object({
  sessionId: z.string().nullable(),
  documentId: z.string(),
  questionId: z.string(),
  driveFileId: z.string(),
  sourceRegion: z.object({
    page: z.number().int().positive(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
});
export type IngestRef = z.infer<typeof IngestRefSchema>;

/**
 * One search hit from the MAIN bank's `Question` collection: the fields the fix screen shows plus
 * the `ingestRef` it needs to re-crop. `id` is the Mongo document id (display/react-key only). The
 * fix flow keys off `ingestRef.questionId` — the stable id we control — so `ingestRef` being null
 * means "found, but not auto-fixable" (no source to re-crop from). Camel-cased here; the bank stores
 * snake_case, mapped at the infrastructure boundary so neither side re-types the other's shape (§6).
 */
export const BankQuestionSchema = z.object({
  id: z.string(),
  fileName: z.string().nullable(),
  questionText: z.string(),
  exam: z.string().nullable(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  options: z.array(z.string()),
  isQuestionImage: z.boolean(),
  questionImage: z.string().nullable(),
  isOptionImage: z.boolean(),
  optionImages: z.array(z.string()),
  ingestRef: IngestRefSchema.nullable(),
});
export type BankQuestion = z.infer<typeof BankQuestionSchema>;

/** Search the published bank by question text or file name (case-insensitive substring). */
export const BankSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type BankSearchQuery = z.infer<typeof BankSearchQuerySchema>;

/**
 * Re-point one image on a published bank question at a freshly cropped URL. `target` selects the
 * question figure or a single option image (`optionIndex` required, and only meaningful, for options).
 */
export const UpdateBankImageSchema = z
  .object({
    target: z.enum(['question', 'option']),
    optionIndex: z.number().int().nonnegative().nullable().default(null),
    url: z.string().min(1),
  })
  .refine((value) => value.target === 'question' || value.optionIndex !== null, {
    message: 'optionIndex is required when target is "option".',
    path: ['optionIndex'],
  });
export type UpdateBankImage = z.infer<typeof UpdateBankImageSchema>;

/**
 * Set or clear the `flagged` mark on a published bank question (the Questions-browse "Flag" toggle),
 * so a question needing later attention stays findable via the Flagged filter. Keyed in the route by
 * the bank Mongo `_id` (which the browse card carries as `id`), so it works even for legacy rows with
 * no `ingest_ref`.
 */
export const UpdateBankFlagSchema = z.object({ flagged: z.boolean() });
export type UpdateBankFlag = z.infer<typeof UpdateBankFlagSchema>;

/** The echoed result of a flag toggle: the row's id and its new flag state. */
export const BankFlagResultSchema = z.object({ id: z.string(), flagged: z.boolean() });
export type BankFlagResult = z.infer<typeof BankFlagResultSchema>;

/**
 * Edit one or more content fields of a published bank question in place — the Questions-browse
 * inline editor AND the per-field "AI fix". Overwrites any subset of the stem, options, answer,
 * explanation, and (for MATRIX questions) the structured match table. Every field is optional so a
 * single field is fixed without resending the rest, and at least one must be present. When `match`
 * is sent the caller also mirrors its key into `answer` (the flat form a plain renderer shows), so
 * the two never drift. Keyed in the route by the bank Mongo `_id` (which the browse card carries as
 * `id`), like the flag toggle, so it works even for legacy rows with no `ingest_ref`.
 */
export const UpdateBankTextSchema = z
  .object({
    questionText: z.string().optional(),
    options: z.array(z.string()).optional(),
    answer: z.string().nullable().optional(),
    // The worked solution/explanation (LaTeX-bearing); null clears it. New editable field — the
    // browse read view has always shown it, this makes it editable in place like the other fields.
    explanation: z.string().nullable().optional(),
    // Structured match-the-column data (columns + correct matching) for a MATRIX question; null on
    // every other type. Persisted to the bank's `match_columns` + `match_key`. The read view renders
    // the match table from these, so this is what makes a matrix's columns editable in the browse.
    match: MatchDataSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.questionText !== undefined ||
      value.options !== undefined ||
      value.answer !== undefined ||
      value.explanation !== undefined ||
      value.match !== undefined,
    { message: 'At least one field to update is required.' },
  );
export type UpdateBankText = z.infer<typeof UpdateBankTextSchema>;

/** The echoed result of a content edit: the row's id and the fields now persisted. */
export const BankTextResultSchema = z.object({
  id: z.string(),
  questionText: z.string().optional(),
  options: z.array(z.string()).optional(),
  answer: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  match: MatchDataSchema.nullable().optional(),
});
export type BankTextResult = z.infer<typeof BankTextResultSchema>;

/**
 * The echoed result of permanently deleting a published bank question (the Questions-browse "Delete"):
 * the removed row's id and a `deleted: true` acknowledgement. Keyed in the route by the bank Mongo
 * `_id` (which the browse card carries as `id`), like the flag/text writes, so it works even for legacy
 * rows with no `ingest_ref`. The delete is permanent — the row is removed from the bank, not soft-hidden.
 */
export const BankDeleteResultSchema = z.object({ id: z.string(), deleted: z.literal(true) });
export type BankDeleteResult = z.infer<typeof BankDeleteResultSchema>;

/**
 * Edit the shared comprehension passage TEXT of a published group, keyed in the route by its
 * `group_id` (the denormalized id every sibling row carries). A passage is repeated identically on
 * every member row, so this rewrites `passage` on ALL rows of the group at once — the browse edits it
 * in one place. The passage FIGURE stays a Verify-only concern (no source page to crop from here).
 */
export const UpdateBankPassageSchema = z.object({ passage: z.string() });
export type UpdateBankPassage = z.infer<typeof UpdateBankPassageSchema>;

/** The echoed result of a passage edit: the group id, the persisted text, and how many rows changed. */
export const BankPassageResultSchema = z.object({
  groupId: z.string(),
  passage: z.string(),
  updated: z.number().int().nonnegative(),
});
export type BankPassageResult = z.infer<typeof BankPassageResultSchema>;
