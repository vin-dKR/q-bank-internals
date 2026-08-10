import { z } from 'zod';

/**
 * One published question as shown on the read-only Questions browse page — a projection of the main
 * bank's `Question` collection: the display fields (stem, options, answer, images) plus the taxonomy
 * used for filtering. Camel-cased here; the bank stores snake_case, mapped at the infrastructure
 * boundary so neither side re-types the other's shape (§6). This is the READ counterpart to the
 * fix-flow's `BankQuestion`; it carries the extra display/taxonomy fields the browse cards need.
 */
export const CatalogQuestionSchema = z.object({
  id: z.string(),
  questionNumber: z.number().int().nullable(),
  fileName: z.string().nullable(),
  questionText: z.string(),
  answer: z.string().nullable(),
  exam: z.string().nullable(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  section: z.string().nullable(),
  questionType: z.string().nullable(),
  topic: z.string().nullable(),
  flagged: z.boolean(),
  options: z.array(z.string()),
  isQuestionImage: z.boolean(),
  questionImage: z.string().nullable(),
  isOptionImage: z.boolean(),
  optionImages: z.array(z.string()),
});
export type CatalogQuestion = z.infer<typeof CatalogQuestionSchema>;

/**
 * The taxonomy filters + keyword + cursor for the browse list. Every field is optional; an omitted
 * or empty field does not constrain the query. `flagged` arrives as a string on the query so it is
 * modelled as an enum here and mapped to a boolean at the controller. `q` searches when ≥ 2 chars.
 */
export const CatalogQuerySchema = z.object({
  exam: z.string().optional(),
  subject: z.string().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
  questionType: z.string().optional(),
  flagged: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

/** One page of browse results: the rows plus the cursor to fetch the next page (null at the end). */
export const CatalogPageSchema = z.object({
  questions: z.array(CatalogQuestionSchema),
  nextCursor: z.string().nullable(),
});
export type CatalogPage = z.infer<typeof CatalogPageSchema>;

/**
 * The distinct values available for each filter dropdown. Cascading: the sets are narrowed by the
 * exam/subject/chapter/questionType already picked, so choosing an exam shrinks the subject list.
 */
export const CatalogFilterOptionsSchema = z.object({
  exams: z.array(z.string()),
  subjects: z.array(z.string()),
  chapters: z.array(z.string()),
  sections: z.array(z.string()),
  questionTypes: z.array(z.string()),
});
export type CatalogFilterOptions = z.infer<typeof CatalogFilterOptionsSchema>;

/** The current selection the filter-options aggregation narrows against (all optional/cascading). */
export const CatalogFilterOptionsQuerySchema = z.object({
  exam: z.string().optional(),
  subject: z.string().optional(),
  chapter: z.string().optional(),
  questionType: z.string().optional(),
});
export type CatalogFilterOptionsQuery = z.infer<typeof CatalogFilterOptionsQuerySchema>;
