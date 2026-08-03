import { z } from 'zod';
import { ExamSchema, ModuleSchema, QuestionTypeSchema } from '../common/vocabulary.js';
import { DriveFileSchema } from '../drive/drive.schema.js';

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

/** Whether an uploaded chapter PDF holds the questions or the answers. */
export const ChapterKindSchema = z.enum(['question', 'answer']);
export type ChapterKind = z.infer<typeof ChapterKindSchema>;

/**
 * Metadata that travels as a JSON form-field alongside the multipart PDF upload. The PDF bytes are
 * built in the browser (cut + reflowed); this describes where it belongs and what it is.
 */
export const ChapterUploadMetadataSchema = ChapterPathSchema.extend({
  sectionName: z.string().min(1),
  questionType: QuestionTypeSchema,
  kind: ChapterKindSchema,
});
export type ChapterUploadMetadata = z.infer<typeof ChapterUploadMetadataSchema>;

/** The created Drive file returned after a successful chapter upload. */
export const UploadChapterResponseSchema = DriveFileSchema;
export type UploadChapterResponse = z.infer<typeof UploadChapterResponseSchema>;
