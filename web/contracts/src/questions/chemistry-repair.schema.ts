import { z } from 'zod';
import { QuestionSchema } from './question.schema.js';

/** Recover source-backed representation without replacing the document's extracted rows. */
export const ChemistryRepairRequestSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1).optional(),
});
export type ChemistryRepairRequest = z.infer<typeof ChemistryRepairRequestSchema>;

export const ChemistryRepairResultSchema = z.object({
  updated: z.array(QuestionSchema),
  unchanged: z.number().int().nonnegative(),
  unresolved: z.array(z.object({
    questionId: z.string(),
    field: z.enum(['stem', 'option', 'answer', 'explanation']),
    message: z.string(),
  })),
});
export type ChemistryRepairResult = z.infer<typeof ChemistryRepairResultSchema>;
