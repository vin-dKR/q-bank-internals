import { z } from 'zod';
import { ReExtractSourceSchema } from './question.schema.js';

/** A normalized rectangle selected on a rendered source page. */
const NormalizedPageBoxSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]).refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0, 'The selected area must have a positive size.');

export const TranscribeQuestionRegionRequestSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().positive(),
  bbox: NormalizedPageBoxSchema,
  destination: z.enum(['stem', 'answer', 'solution']),
  source: ReExtractSourceSchema.optional(),
});

export const TranscribeQuestionRegionResponseSchema = z.object({
  text: z.string().min(1),
});

export type TranscribeQuestionRegionRequest = z.infer<typeof TranscribeQuestionRegionRequestSchema>;
export type TranscribeQuestionRegionResponse = z.infer<typeof TranscribeQuestionRegionResponseSchema>;
