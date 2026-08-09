import { z } from 'zod';
import { ChapterKindSchema, ExamSchema, ModuleSchema, QuestionTypeSchema, SourceSchema } from '../common/vocabulary.js';
import { DriveFileSchema } from '../drive/drive.schema.js';
import { ChapterTopicSchema, DocumentSchema } from '../documents/document.schema.js';

/**
 * The nested-folder trail a cut chapter is filed under in Drive: exam → subject → module → chapter.
 * The ingestion service ensures each level exists (idempotently) before uploading.
 */
export const ChapterPathSchema = z.object({
  exam: ExamSchema,
  subject: z.string().min(1),
  module: ModuleSchema,
  chapter: z.string().min(1),
});
export type ChapterPath = z.infer<typeof ChapterPathSchema>;

/**
 * Metadata that travels as a JSON form-field alongside the multipart PDF upload. The PDF bytes are
 * built in the browser (cut + reflowed); this describes where it belongs and what it is.
 *
 * `sessionId` ties the upload to the durable Phase-1 session it belongs to, so the backend can
 * persist a Document record the moment the bytes land (see the ingestion service).
 */
export const ChapterUploadMetadataSchema = ChapterPathSchema.extend({
  sessionId: z.string().min(1),
  sectionName: z.string().min(1),
  questionType: QuestionTypeSchema,
  kind: ChapterKindSchema,
  /** Optional provenance of the chapter's questions: pyq / module / textbook (open string). */
  source: SourceSchema.optional(),
  /**
   * Optional topic-level structure of a QUESTION part: each topic's predefined question-type blocks
   * with the page spans they occupy in the uploaded PDF. Omitted for the chapter-wise flow (and for
   * answer/solution parts) — the pipeline behaves exactly as before when absent.
   */
  topics: z.array(ChapterTopicSchema).optional(),
});
export type ChapterUploadMetadata = z.infer<typeof ChapterUploadMetadataSchema>;

/** What a successful chapter upload returns: the durable Document row plus the created Drive file. */
export const UploadChapterResponseSchema = z.object({
  document: DocumentSchema,
  driveFile: DriveFileSchema,
});
export type UploadChapterResponse = z.infer<typeof UploadChapterResponseSchema>;
