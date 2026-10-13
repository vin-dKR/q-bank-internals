import { z } from 'zod';

const ChemistrySourceBoxSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().positive().max(1),
  z.number().positive().max(1),
]).refine(([x, y, width, height]) => x + width <= 1.000001 && y + height <= 1.000001);

/** Source-backed chemistry candidates are retained for audit; they never claim graph verification. */
export const ChemistryExtractionSchema = z.object({
  version: z.literal(1),
  status: z.enum(['source_preserved', 'needs_review']),
  issues: z.array(z.string()),
  candidateStem: z.string(),
  candidateOptions: z.array(z.string()),
  visuals: z.array(z.object({
    id: z.string(),
    field: z.enum(['stem', 'option']),
    optionLabel: z.string().nullable(),
    kind: z.enum(['molecule', 'reaction', 'figure']),
    /** Normalized source-page rectangle: x, y, width, height. */
    bbox: ChemistrySourceBoxSchema,
    /** Separate physical source rectangles in reading order when a field continues in another column. */
    regions: z.array(ChemistrySourceBoxSchema).min(1).optional(),
    candidateSmiles: z.array(z.string()),
    graphValid: z.boolean().nullable(),
    cropUrl: z.string().nullable(),
  })),
});
export type ChemistryExtraction = z.infer<typeof ChemistryExtractionSchema>;
