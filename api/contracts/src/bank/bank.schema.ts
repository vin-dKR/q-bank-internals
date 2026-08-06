import { z } from 'zod';

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
