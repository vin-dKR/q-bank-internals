import { z } from 'zod';
import { SourcePathSchema } from '../common/source-path.js';

/** A figure extracted from the page, stored in Drive and referenced by the question. */
export const QuestionImageSchema = z.object({
  driveFileId: z.string(),
  alt: z.string(),
});
export type QuestionImage = z.infer<typeof QuestionImageSchema>;

/** One answer option. `body` is LaTeX-bearing text (rendered with KaTeX on the client). */
export const QuestionOptionSchema = z.object({
  label: z.string().min(1), // "A", "B", ...
  body: z.string(),
  isCorrect: z.boolean(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

/**
 * The verified question record — the thing published to the bank.
 * `sourceRegion` keeps the page + bounding box it was read from, so a bad extraction stays fixable.
 */
export const QuestionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  path: SourcePathSchema,
  stem: z.string(), // LaTeX-bearing
  options: z.array(QuestionOptionSchema),
  answer: z.string(),
  images: z.array(QuestionImageSchema),
  sourceRegion: z.object({
    page: z.number().int().positive(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Question = z.infer<typeof QuestionSchema>;

/** Editable fields — what the verify screen is allowed to change before publishing. */
export const UpdateQuestionSchema = QuestionSchema.pick({
  stem: true,
  options: true,
  answer: true,
  images: true,
}).partial();
export type UpdateQuestion = z.infer<typeof UpdateQuestionSchema>;
