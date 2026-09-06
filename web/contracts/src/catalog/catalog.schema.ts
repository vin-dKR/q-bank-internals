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
  // Comprehension grouping (BLA-125): the shared passage (repeated on every sibling row), the group's
  // stable id, and this sub-question's order within it. The browse list groups consecutive rows sharing
  // `groupId` under one passage header. All null on ordinary questions and on legacy rows.
  passage: z.string().nullable(),
  groupId: z.string().nullable(),
  groupOrder: z.number().int().nullable(),
  flagged: z.boolean(),
  // PYQ provenance stamped at publish: whether the question is a previous-year question, and the
  // exam + year it was asked in. `isPyq` is false and exam/year null on non-PYQ or legacy rows.
  isPyq: z.boolean(),
  pyqExam: z.string().nullable(),
  pyqYear: z.string().nullable(),
  // The ingest document this question was published from (read off `ingest_ref.document_id`), so the
  // browse card's "Edit" can reopen it in Verify at `/verify?documentId=…`. Null on legacy rows
  // published before provenance was stamped — those cannot be reopened, so Edit is hidden.
  documentId: z.string().nullable(),
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
  module: z.string().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
  questionType: z.string().optional(),
  flagged: z.enum(['true', 'false']).optional(),
  pyq: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

/**
 * One page of browse results: the rows, the cursor to fetch the next page (null at the end), and
 * `total` — the count of ALL published questions matching the current filters, independent of
 * pagination, so the browse header can show "Showing X of N" (N is the grand total when unfiltered).
 */
export const CatalogPageSchema = z.object({
  questions: z.array(CatalogQuestionSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type CatalogPage = z.infer<typeof CatalogPageSchema>;

/**
 * The distinct values available for each filter dropdown. Cascading: the sets are narrowed by the
 * exam/subject/chapter/questionType already picked, so choosing an exam shrinks the subject list.
 */
export const CatalogFilterOptionsSchema = z.object({
  exams: z.array(z.string()),
  subjects: z.array(z.string()),
  modules: z.array(z.string()),
  chapters: z.array(z.string()),
  sections: z.array(z.string()),
  questionTypes: z.array(z.string()),
});
export type CatalogFilterOptions = z.infer<typeof CatalogFilterOptionsSchema>;

/** The current selection the filter-options aggregation narrows against (all optional/cascading). */
export const CatalogFilterOptionsQuerySchema = z.object({
  exam: z.string().optional(),
  subject: z.string().optional(),
  module: z.string().optional(),
  chapter: z.string().optional(),
  questionType: z.string().optional(),
});
export type CatalogFilterOptionsQuery = z.infer<typeof CatalogFilterOptionsQuerySchema>;
