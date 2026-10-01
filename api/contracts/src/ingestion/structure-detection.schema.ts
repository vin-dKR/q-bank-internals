import { z } from 'zod';
import {
  AnswerLayoutSchema,
  PaperMetadataSchema,
  type AnswerLayout,
} from '../common/paper-metadata.js';
import { KNOWN_QUESTION_TYPES, type ChapterKind } from '../common/vocabulary.js';
import { StructureDetectionUsageSchema } from './structure-cost.schema.js';
import { StructureRuleSchema } from '../structure-rules/structure-rule.schema.js';
import { StructureTextCropSchema } from './structure-crop.schema.js';
import { StructureExtractedCropSchema } from './structure-crop-headings.schema.js';

/** Operator-supplied context, never generated or overwritten by detection. */
export const StructureDetectionContextSchema = z
  .object({
    source: z.string(),
    exam: z.string(),
    subject: z.string(),
    module: z.string(),
    chapter: z.string(),
    sectionName: z.string(),
    questionType: z.string(),
    pyq: z.boolean(),
    pyqExam: z.string(),
    pyqYear: z.string(),
    paper: PaperMetadataSchema,
    answerLayout: AnswerLayoutSchema,
  })
  .strict();
export type StructureDetectionContext = z.infer<typeof StructureDetectionContextSchema>;

export const StructureEstimateRequestSchema = z
  .object({
    pageCount: z.number().int().positive().max(10000),
    context: StructureDetectionContextSchema,
    crops: z.array(StructureTextCropSchema).min(1).max(1000),
    savedCrops: z.array(StructureExtractedCropSchema).max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.crops.map((crop) => crop.id)).size !== value.crops.length)
      ctx.addIssue({ code: 'custom', message: 'Crop IDs must be unique.', path: ['crops'] });
    if (
      value.savedCrops &&
      new Set(value.savedCrops.map((crop) => crop.cropId)).size !== value.savedCrops.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Saved crop IDs must be unique.',
        path: ['savedCrops'],
      });
    if (value.crops.some((crop) => crop.pageNumber > value.pageCount))
      ctx.addIssue({
        code: 'custom',
        message: 'A crop references a page outside this PDF.',
        path: ['crops'],
      });
    if (value.crops.reduce((sum, crop) => sum + crop.text.length, 0) > 250000)
      ctx.addIssue({
        code: 'custom',
        message: 'Use at most 250,000 characters of reviewed crop text per detection.',
        path: ['crops'],
      });
  });
export type StructureEstimateRequest = z.infer<typeof StructureEstimateRequestSchema>;

export const DetectStructureRequestSchema = z
  .object({
    pageCount: z.number().int().positive(),
    context: StructureDetectionContextSchema,
    crops: z.array(StructureTextCropSchema).min(1).max(1000),
    savedCrops: z.array(StructureExtractedCropSchema).max(1000).optional(),
    cropOnly: z.literal(true).optional(),
    sessionId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const checked = StructureEstimateRequestSchema.safeParse({
      pageCount: value.pageCount,
      context: value.context,
      crops: value.crops,
      ...(value.savedCrops ? { savedCrops: value.savedCrops } : {}),
    });
    if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue(issue);
    if (value.cropOnly && value.crops.length !== 1)
      ctx.addIssue({ code: 'custom', message: 'Extract one crop at a time.', path: ['crops'] });
  });
export type DetectStructureRequest = z.infer<typeof DetectStructureRequestSchema>;

const PageListSchema = z.array(z.number().int().positive());
export const StructurePagesSchema = z
  .object({
    question: PageListSchema.optional(),
    answer: PageListSchema.optional(),
    solution: PageListSchema.nullable().optional(),
    companion: PageListSchema.optional(),
  })
  .strict();
export type StructurePages = z.infer<typeof StructurePagesSchema>;
export const DetectedStructureNodeFieldsSchema = z.object({
  label: z.string(),
  level: z.enum(['section', 'part', 'topic']).nullable(),
  questionType: z.enum(['', ...KNOWN_QUESTION_TYPES]),
  subject: z.string(),
  pyq: z.boolean(),
  pages: StructurePagesSchema,
});
// The recursive child relationship is the only manually declared part of this inferred DTO.
export type DetectedStructureNode = z.infer<typeof DetectedStructureNodeFieldsSchema> & {
  children: DetectedStructureNode[];
};
export const DetectedStructureNodeSchema: z.ZodType<DetectedStructureNode> = z.lazy(() =>
  DetectedStructureNodeFieldsSchema.extend({
    children: z.array(DetectedStructureNodeSchema),
  }).strict(),
);
export const DetectedStructureSchema = z
  .object({
    nodes: z.array(DetectedStructureNodeSchema),
    warnings: z.array(z.string()).optional(),
    cropResults: z.array(StructureExtractedCropSchema).max(1000).optional(),
    aiCallCount: z.number().int().min(0).optional(),
  })
  .strict();
export const DetectStructureResultSchema = DetectedStructureSchema.extend({
  version: z.literal(1),
  pageCount: z.number().int().positive(),
  answerLayout: AnswerLayoutSchema,
  warnings: z.array(z.string()),
  usage: StructureDetectionUsageSchema.nullable(),
  rule: StructureRuleSchema.nullable().optional(),
}).strict();
export type DetectStructureResult = z.infer<typeof DetectStructureResultSchema>;

/** The same layout contract drives the AI schema, validation, and editor's attachment slots. */
export function structureKindsForLayout(layout: AnswerLayout): readonly ChapterKind[] {
  if (layout === 'inline') return ['question'];
  if (layout === 'combined') return ['question', 'companion'];
  return ['question', 'answer', 'solution'];
}
