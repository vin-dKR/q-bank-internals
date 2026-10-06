import { z } from 'zod';
import { KNOWN_QUESTION_TYPES } from '../common/vocabulary.js';
import { StructureCropRoleSchema } from './structure-crop.schema.js';
import { StructureLevelIdSchema } from '../structure-rules/structure-hierarchy.schema.js';

export const StructureQuestionTypeObservationSchema = z
  .object({
    value: z.enum(KNOWN_QUESTION_TYPES),
    printed: z.string().trim().min(1).max(500),
    level: StructureLevelIdSchema,
  })
  .strict();

const HeadingSchema = z
  .object({
    printed: z.string().trim().min(1).max(500),
    label: z.string().trim().max(500),
  })
  .strict()
  .nullable();

export const StructureCropHeadingSchema = z
  .object({
    section: HeadingSchema,
    part: HeadingSchema,
    topic: HeadingSchema,
    // New profiles carry all configured levels; legacy fields remain for old OCR drafts.
    headings: z.record(StructureLevelIdSchema, HeadingSchema).optional(),
    questionType: StructureQuestionTypeObservationSchema.nullable(),
  })
  .strict();
export type StructureCropHeading = z.infer<typeof StructureCropHeadingSchema>;

/** Reuse requires the same OCR text, manual context and saved source rules; evidence is rechecked. */
export const StructureExtractedCropSchema = z
  .object({
    cropId: z.string().min(1).max(80),
    text: z.string().max(12000),
    // A full 16-level guide plus legacy examples/notes can exceed the old three-level limit.
    contextKey: z.string().max(60000),
    role: StructureCropRoleSchema.optional(),
    items: z.array(StructureCropHeadingSchema).max(500),
  })
  .strict();
export type StructureExtractedCrop = z.infer<typeof StructureExtractedCropSchema>;
