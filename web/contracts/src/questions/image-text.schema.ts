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
  destination: z.enum(['stem', 'option', 'answer', 'solution']),
  /** The one option body to replace when destination is `option`; labels remain unchanged. */
  optionIndex: z.number().int().nonnegative().optional(),
  source: ReExtractSourceSchema.optional(),
}).superRefine((input, context) => {
  if (input.destination === 'option' && input.optionIndex === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['optionIndex'],
      message: 'An option transcription requires the selected option index.',
    });
  }
  if (input.destination !== 'option' && input.optionIndex !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['optionIndex'],
      message: 'Only option transcriptions may include an option index.',
    });
  }
});

export const TranscribeQuestionRegionResponseSchema = z.object({
  text: z.string().min(1),
});

export type TranscribeQuestionRegionRequest = z.infer<typeof TranscribeQuestionRegionRequestSchema>;
export type TranscribeQuestionRegionResponse = z.infer<typeof TranscribeQuestionRegionResponseSchema>;
