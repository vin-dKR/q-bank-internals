import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';

/** Lifecycle of a section PDF as it moves through the pipeline. The web dropdown filters on this. */
export const DocumentStatusSchema = z.enum([
  'uploaded', // sitting in Drive, not yet extracted
  'queued', // handed to the extractor
  'extracting', // vision model running
  'needs_review', // drafts produced, awaiting a human
  'approved', // a person accepted the drafts
  'published', // pushed to the question bank
  'failed', // extraction errored; safe to retry
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/** A section PDF that lives in Drive and is (or will be) a source of questions. */
export const DocumentSchema = z.object({
  id: z.string(),
  driveFileId: z.string(),
  fileName: z.string(),
  path: SourcePathSchema,
  status: DocumentStatusSchema,
  questionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** Body accepted when registering a Drive file as a pipeline document. */
export const RegisterDocumentSchema = z.object({
  driveFileId: z.string().min(1),
  fileName: z.string().min(1),
  path: SourcePathSchema,
});
export type RegisterDocument = z.infer<typeof RegisterDocumentSchema>;
