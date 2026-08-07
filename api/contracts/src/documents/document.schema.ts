import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';
import { PaginationQuerySchema } from '../common/pagination.js';
import { ChapterKindSchema, QuestionTypeSchema } from '../common/vocabulary.js';

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
 */
export const TopicTypeConfigSchema = z.object({
  questionType: QuestionTypeSchema,
  pageRange: PageRangeSchema,
});
export type TopicTypeConfig = z.infer<typeof TopicTypeConfigSchema>;

/**
 * One topic inside a chapter PDF (Chapter → Topic → Question type → Questions): its name plus the
 * ordered question-type blocks it contains.
 */
export const ChapterTopicSchema = z.object({
  name: z.string().min(1),
  types: z.array(TopicTypeConfigSchema).min(1),
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
  path: SourcePathSchema,
  kind: ChapterKindSchema,
  sectionName: z.string().nullable(),
  questionType: QuestionTypeSchema.nullable(),
  pageRange: PageRangeSchema.nullable(),
  /** Operator-defined topic → question-type map of the question PDF; empty for chapter-only documents. */
  topics: z.array(ChapterTopicSchema),
  status: DocumentStatusSchema,
  questionCount: z.number().int().nonnegative(),
  extractedAt: z.string().datetime().nullable(),
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
  pageRange: PageRangeSchema.nullable().optional(),
  topics: z.array(ChapterTopicSchema).optional(),
});
export type RegisterDocument = z.infer<typeof RegisterDocumentSchema>;

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
