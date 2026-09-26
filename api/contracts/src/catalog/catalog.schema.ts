import { z } from 'zod';
import { MatchDataSchema } from '../questions/question.schema.js';
import { AiFilledSchema } from '../common/ai-filled.js';

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
  // The worked solution / explanation (LaTeX-bearing) stamped at publish; null when the source had
  // none or on legacy rows. Surfaced so the browse renders the same complete question the bank stores.
  explanation: z.string().nullable(),
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
  // The passage's shared figure (Supabase URL), denormalized onto every sibling row at publish like
  // `passage`; null when the passage has no image or on legacy rows. Lets the browse render the shared
  // comprehension figure the verify screen crops — the one place it was previously dropped.
  passageImage: z.string().nullable(),
  groupId: z.string().nullable(),
  groupOrder: z.number().int().nullable(),
  flagged: z.boolean(),
  // PYQ provenance stamped at publish: whether the question is a previous-year question, and the
  // exam + year it was asked in. `isPyq` is false and exam/year null on non-PYQ or legacy rows.
  isPyq: z.boolean(),
  pyqExam: z.string().nullable(),
  pyqYear: z.string().nullable(),
  // The exact ingest source this question was published from. `questionId` lets a browse card reopen
  // Verify on the original page and ring the original extracted question, not merely reopen the unit.
  // Both are null on legacy rows published before provenance was stamped.
  documentId: z.string().nullable(),
  ingestQuestionId: z.string().nullable(),
  options: z.array(z.string()),
  isQuestionImage: z.boolean(),
  questionImage: z.string().nullable(),
  isOptionImage: z.boolean(),
  optionImages: z.array(z.string()),
  // Figures printed with the answer key and the worked solution. The bank stores each as a
  // comma-separated field for compatibility with its existing question-image format.
  answerImages: z.array(z.string()),
  explanationImages: z.array(z.string()),
  // Structured match-the-column data (columns + correct matching) for MATRIX questions; null for every
  // other type. Assembled from the bank's `match_columns` + `match_key` (written at publish) so the
  // browse renders a real match table instead of the raw "(A) A-p,B-q" option strings.
  match: MatchDataSchema.nullable(),
  // Which of topic/answer/solution/level hold an AI-written value (the row's `ai_filled`); empty when none
  // do. Lets the browse mark machine-filled data so it is never mistaken for a human's.
  aiFilled: AiFilledSchema,
});
export type CatalogQuestion = z.infer<typeof CatalogQuestionSchema>;

/**
 * How the browse list is ordered. Both keys sort on the row's Mongo `_id`, which encodes creation
 * time — so `newest` is `_id` descending, `oldest` is ascending. Keeping the sort on `_id` (always
 * present, unique) is what lets cursor pagination and the contiguous-siblings comprehension grouping
 * keep working unchanged; only the direction (and the cursor comparison) flips.
 */
export const CatalogSortSchema = z.enum(['newest', 'oldest']);
export type CatalogSort = z.infer<typeof CatalogSortSchema>;

/**
 * The taxonomy filters + keyword + cursor for the browse list. Every field is optional; an omitted
 * or empty field does not constrain the query. `flagged` arrives as a string on the query so it is
 * modelled as an enum here and mapped to a boolean at the controller. `q` searches when ≥ 2 chars.
 * The `has*` flags are the "Content" edge-case filters (image / passage / matrix presence) — each
 * narrows to rows that HAVE the feature, and all of them AND-combine with the taxonomy filters.
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
  hasImage: z.enum(['true', 'false']).optional(),
  hasQuestionImage: z.enum(['true', 'false']).optional(),
  hasOptionImage: z.enum(['true', 'false']).optional(),
  hasPassageImage: z.enum(['true', 'false']).optional(),
  hasPassage: z.enum(['true', 'false']).optional(),
  hasMatch: z.enum(['true', 'false']).optional(),
  // Only rows with at least one AI-filled field.
  aiFilled: z.enum(['true', 'false']).optional(),
  q: z.string().optional(),
  // Ordering — defaults to newest-first (most recently published on top). A cursor is only valid for
  // the sort it was minted under, so the client refetches from page one whenever the sort changes.
  sort: CatalogSortSchema.default('newest'),
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
