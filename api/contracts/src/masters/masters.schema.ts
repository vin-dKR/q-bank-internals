import { z } from 'zod';

/**
 * The API boundary for Masters → Question taxonomy: CRUD over the shared bank's normalized dictionary
 * collections (Exam / Subject / Chapter / Section / QuestionType / Level / Topic). One generic shape
 * serves every dimension (§6 DRY) — per-dimension extras (`kind`, `rank`, `subjectId`, `chapterId`)
 * are carried as nullable fields, always present on a read so the client never guesses.
 */

/** The eight managed taxonomy dimensions, in display order. */
export const TAXONOMY_DIMENSIONS = [
  'exam',
  'subject',
  'module',
  'chapter',
  'section',
  'questionType',
  'level',
  'topic',
] as const;
export const TaxonomyDimensionSchema = z.enum(TAXONOMY_DIMENSIONS);
export type TaxonomyDimension = z.infer<typeof TaxonomyDimensionSchema>;

/**
 * Dimensions whose vocabulary is CLOSED (a fixed set of kinds/levels). The UI hides free create/delete
 * for these; the backend only admits values that fold to a recognised canonical entry.
 */
export const CLOSED_TAXONOMY_DIMENSIONS = ['questionType', 'level'] as const;

/** One dictionary row as the client sees it. `questionCount` is how many bank questions use it. */
export const DictionaryEntrySchema = z.object({
  id: z.string(),
  dimension: TaxonomyDimensionSchema,
  key: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  /** questionType only — the canonical kind this row branches on; null on other dimensions. */
  kind: z.string().nullable(),
  /** level only — 1|2|3 for easy→hard sort; null on other dimensions. */
  rank: z.number().int().nullable(),
  /** chapter/module only — the subject it is scoped to; null otherwise / unresolved. */
  subjectId: z.string().nullable(),
  /** topic only — the chapter it is scoped to; null otherwise / unresolved. */
  chapterId: z.string().nullable(),
  questionCount: z.number().int().nonnegative(),
});
export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>;

export const DictionaryListSchema = z.object({
  dimension: TaxonomyDimensionSchema,
  entries: z.array(DictionaryEntrySchema),
});
export type DictionaryList = z.infer<typeof DictionaryListSchema>;

/** Query for a dictionary list: a name substring + parent-scope filters (chapters by subject, etc.). */
export const DictionaryQuerySchema = z.object({
  q: z.string().trim().optional(),
  subjectId: z.string().optional(),
  chapterId: z.string().optional(),
});
export type DictionaryQuery = z.infer<typeof DictionaryQuerySchema>;

/**
 * Create one dictionary entry. `name` is folded to a canonical `key` server-side (a known alias maps
 * to the existing row and 409s). `kind` is required for questionType, `rank`/inferred for level,
 * `subjectId` scopes a chapter/module, `chapterId` scopes a topic — all validated by the service.
 */
export const CreateDictionaryEntrySchema = z.object({
  name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1)).optional(),
  kind: z.string().trim().min(1).optional(),
  rank: z.number().int().min(1).optional(),
  subjectId: z.string().optional(),
  chapterId: z.string().optional(),
});
export type CreateDictionaryEntry = z.infer<typeof CreateDictionaryEntrySchema>;

/** Patch one dictionary entry. At least one field must be present. */
export const UpdateDictionaryEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    aliases: z.array(z.string().trim().min(1)).optional(),
    kind: z.string().trim().min(1).optional(),
    rank: z.number().int().min(1).optional(),
    subjectId: z.string().nullable().optional(),
    chapterId: z.string().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Provide at least one field to update.' });
export type UpdateDictionaryEntry = z.infer<typeof UpdateDictionaryEntrySchema>;

/** Result of seeding a dimension's canonical starting set. */
export const SeedDictionarySchema = z.object({
  dimension: TaxonomyDimensionSchema,
  created: z.number().int().nonnegative(),
  entries: z.array(DictionaryEntrySchema),
});
export type SeedDictionary = z.infer<typeof SeedDictionarySchema>;
