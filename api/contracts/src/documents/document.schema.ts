import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';
import { PaginationQuerySchema } from '../common/pagination.js';
import { ChapterKindSchema, QuestionTypeSchema, SourceSchema } from '../common/vocabulary.js';
import { AnswerLayoutSchema, PaperMetadataSchema } from '../common/paper-metadata.js';

/** Lifecycle of a section PDF as it moves through the pipeline. The web dropdown filters on this. */
export const DocumentStatusSchema = z.enum([
  'uploaded', // sitting in Drive, not yet extracted
  'queued', // handed to the extractor
  'extracting', // vision model running
  'extracted', // questions produced by the model, awaiting review/merge
  'needs_review', // drafts produced, awaiting a human
  'approved', // a person accepted the drafts
  'published', // pushed to the question bank
  'completed', // fully done for this pipeline (extracted + accepted)
  'failed', // extraction errored; safe to retry
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** The page span (1-based, inclusive) a section occupies within its source PDF. */
export const PageRangeSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
});
export type PageRange = z.infer<typeof PageRangeSchema>;

/**
 * One question-type block inside a topic: a predefined type bound to the page span it occupies in
 * the uploaded question PDF. The operator fixes this at cut time, so extraction maps every question
 * on those pages to exactly this type — the model never picks or invents one.
 *
 * `answerPageRange` / `solutionPageRange` are the same topic's spans in the sibling answer / solution
 * PDFs. When present (v2 assembled uploads), the extractor reads this topic's answers/explanations
 * from exactly those pages and binds them to this topic's questions — the operator's drag decides the
 * association, not a section-name-and-number guess. Absent for legacy uploads (behaviour unchanged).
 *
 * `pyq` is the operator's per-node previous-year-questions toggle for this segment. When set,
 * extraction asks the model to read each question's SOURCE exam + year printed on the page
 * (`question.pyqExam`/`pyqYear`, e.g. "NEET 2019") — a separate axis from the document-level target
 * exam/subject. Absent/false on ordinary segments and on legacy uploads.
 */
export const TopicTypeConfigSchema = z.object({
  // Optional: a PYQ paper's questions are of mixed types, so its segments leave this blank and are
  // extracted generically. Every other source still sets it (enforced in the cut-upload assembly).
  questionType: QuestionTypeSchema.optional(),
  pageRange: PageRangeSchema,
  answerPageRange: PageRangeSchema.optional(),
  solutionPageRange: PageRangeSchema.optional(),
  pyq: z.boolean().optional(),
});
export type TopicTypeConfig = z.infer<typeof TopicTypeConfigSchema>;

/**
 * One topic inside a chapter PDF (Chapter → Section → Part → Topic → Questions): its `name` plus the
 * ordered question-type blocks it contains.
 *
 * `name` is the UNIQUE per-leaf key used to match this topic's questions to their answer/solution
 * sheet section (see `merge-answers`) — it carries the full joined tree path and must not be
 * overloaded with display meaning. `sectionName` / `topicName` are the split display identity the
 * operator built in the v2 tree: `sectionName` is the top (Section) node's label and flows to
 * `question.sectionName` → the bank's `section_name`; `topicName` is the leaf (Topic) node's label
 * and flows to `question.topic` → the bank's `topic`. Both are omitted for legacy uploads and for
 * branches that lack that level, in which case extraction falls back to the document-level values.
 */
export const ChapterTopicSchema = z.object({
  name: z.string().min(1),
  types: z.array(TopicTypeConfigSchema).min(1),
  sectionName: z.string().optional(),
  topicName: z.string().optional(),
  /** Operator's per-node subject for this leaf → each question's `subject` (a PYQ paper spans subjects). */
  subject: z.string().optional(),
});
export type ChapterTopic = z.infer<typeof ChapterTopicSchema>;

/**
 * A section PDF that lives in Drive and is (or will be) a source of questions. Belongs to an ingest
 * session; carries the Phase-1 metadata (kind/section/questionType/page range) the extractor needs.
 */
export const DocumentSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  driveFileId: z.string(),
  fileName: z.string(),
  /**
   * The upload's identity within its session: shared by the question/answer/solution parts of one
   * upload, fresh per upload. Empty string on legacy rows uploaded before this existed (they fall back
   * to the old unit-path sibling matching).
   */
  uploadGroupId: z.string().default(''),
  path: SourcePathSchema,
  kind: ChapterKindSchema,
  sectionName: z.string().nullable(),
  questionType: QuestionTypeSchema.nullable(),
  /** The exam this chapter's questions belong to (e.g. NEET) — the operator's per-chapter pick. Null on legacy documents. */
  exam: z.string().nullable(),
  /** The subject this chapter's questions belong to (e.g. Biology). Null on legacy documents. */
  subject: z.string().nullable(),
  /** Whether this chapter's questions are previous-year questions (PYQ), captured at cut time. */
  pyq: z.boolean(),
  /** The exam a PYQ chapter's questions were asked in (e.g. NEET); null unless `pyq` is set. */
  pyqExam: z.string().nullable(),
  /** The year a PYQ chapter's questions were asked (e.g. "2019"); null unless `pyq` is set. */
  pyqYear: z.string().nullable(),
  /** Paper-level PYQ provenance (exam name/year/session/shift/paper code …); null when not a PYQ upload. */
  paper: PaperMetadataSchema.nullable(),
  /** How answers are laid out in the source PDF: `separate` (grouped/sibling) or `inline` (with each question). */
  answerLayout: AnswerLayoutSchema.default('separate'),
  /** Where the questions came from: pyq / module / textbook (open string). Null for legacy documents. */
  source: SourceSchema.nullable(),
  pageRange: PageRangeSchema.nullable(),
  /** Operator-defined topic → question-type map of the question PDF; empty for chapter-only documents. */
  topics: z.array(ChapterTopicSchema),
  status: DocumentStatusSchema,
  /** Operator flag: this file didn't extract cleanly and is marked to be fixed manually later. */
  flagged: z.boolean(),
  questionCount: z.number().int().nonnegative(),
  extractedAt: z.string().datetime().nullable(),
  /** Soft-delete tombstone: non-null once removed (hidden from listings, still fetchable by id). */
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** Body accepted when registering a Drive file as a pipeline document. */
export const RegisterDocumentSchema = z.object({
  sessionId: z.string().min(1).nullable().optional(),
  driveFileId: z.string().min(1),
  fileName: z.string().min(1),
  path: SourcePathSchema,
  kind: ChapterKindSchema.default('question'),
  sectionName: z.string().min(1).nullable().optional(),
  questionType: QuestionTypeSchema.nullable().optional(),
  exam: z.string().min(1).nullable().optional(),
  subject: z.string().min(1).nullable().optional(),
  pyq: z.boolean().optional(),
  pyqExam: z.string().min(1).nullable().optional(),
  pyqYear: z.string().min(1).nullable().optional(),
  paper: PaperMetadataSchema.nullable().optional(),
  answerLayout: AnswerLayoutSchema.optional(),
  source: SourceSchema.nullable().optional(),
  pageRange: PageRangeSchema.nullable().optional(),
  topics: z.array(ChapterTopicSchema).optional(),
});
export type RegisterDocument = z.infer<typeof RegisterDocumentSchema>;

/** Patch accepted when editing a document — currently just the operator's manual-fix flag. */
export const UpdateDocumentSchema = z
  .object({
    flagged: z.boolean(),
  })
  .partial();
export type UpdateDocument = z.infer<typeof UpdateDocumentSchema>;

/**
 * Query for listing documents. Narrows by session and/or one-or-more statuses — this is what powers
 * the operator filter ("which files are still uploaded vs. extracted vs. completed").
 */
export const DocumentListQuerySchema = PaginationQuerySchema.extend({
  sessionId: z.string().optional(),
  status: z
    .union([DocumentStatusSchema, z.array(DocumentStatusSchema)])
    .optional()
    .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value])),
});
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;
