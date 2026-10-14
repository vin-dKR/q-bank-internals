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
  status: z.enum(['source_preserved', 'transcription_reviewed', 'needs_review']),
  /** Legacy records default to source display until explicitly restored. */
  representation: z.enum(['transcription', 'source']).optional(),
  issues: z.array(z.string()),
  candidateStem: z.string(),
  candidateOptions: z.array(z.string()),
  candidateAnswer: z.string().optional(),
  candidateExplanation: z.string().optional(),
  sourceMoleculeCounts: z.object({
    answer: z.number().int().nonnegative().optional(),
    explanation: z.number().int().nonnegative().optional(),
  }).optional(),
  unresolvedSourceFields: z.array(z.enum(['answer', 'explanation'])).optional(),
  molecularAudits: z.array(z.object({
    candidateId: z.string(),
    fieldPath: z.string(),
    status: z.enum(['matched', 'corrected', 'unresolved']),
    message: z.string(),
    canonicalSmiles: z.string().optional(),
    graphFingerprint: z.string().optional(),
    sourceDocumentId: z.string().optional(),
    sourcePage: z.number().int().positive().optional(),
  })).optional(),
  visuals: z.array(z.object({
    id: z.string(),
    field: z.enum(['stem', 'option', 'answer', 'explanation']),
    optionLabel: z.string().nullable(),
    kind: z.enum(['molecule', 'reaction', 'figure']),
    /** Normalized source-page rectangle: x, y, width, height. */
    bbox: ChemistrySourceBoxSchema,
    /** Separate physical source rectangles in reading order when a field continues in another column. */
    regions: z.array(ChemistrySourceBoxSchema).min(1).optional(),
    candidateSmiles: z.array(z.string()),
    graphValid: z.boolean().nullable(),
    moleculeCount: z.number().int().nonnegative().optional(),
    cropUrl: z.string().nullable(),
    sourceDocumentId: z.string().optional(),
    sourcePage: z.number().int().positive().optional(),
  })),
});
export type ChemistryExtraction = z.infer<typeof ChemistryExtractionSchema>;

/** Readonly evidence returned with an unsaved reread; saving text still requires source review. */
export const MolecularReadDiagnosticsSchema = z.object({
  molecularAudits: ChemistryExtractionSchema.shape.molecularAudits,
  chemistryIssues: z.array(z.string()).optional(),
});
