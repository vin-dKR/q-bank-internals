import { z } from 'zod';
import { StructureLevelIdSchema } from '../structure-rules/structure-hierarchy.schema.js';

export const STRUCTURE_CROP_ROLES = ['combined', 'section', 'part', 'topic'] as const;
export const StructureCropRoleSchema = z.union([z.literal('combined'), StructureLevelIdSchema]);
export type StructureCropRole = z.infer<typeof StructureCropRoleSchema>;

/** Coordinates refer to the displayed page, measured from its top-left corner. */
export const StructureCropBoundsSchema = z
  .object({
    x0: z.number().min(0).max(1),
    y0: z.number().min(0).max(1),
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
  })
  .strict()
  .refine(
    (box) => box.x1 > box.x0 && box.y1 > box.y0,
    'Select a crop with positive width and height.',
  );
export type StructureCropBounds = z.infer<typeof StructureCropBoundsSchema>;

export const StructureCropSchema = z
  .object({
    id: z.string().min(1).max(80),
    pageNumber: z.number().int().positive(),
    bounds: StructureCropBoundsSchema,
    // Missing roles in older drafts retain combined-heading behavior.
    role: StructureCropRoleSchema.optional(),
  })
  .strict();
export type StructureCrop = z.infer<typeof StructureCropSchema>;

export const StructureTextCropSchema = z
  .object({
    id: z.string().min(1).max(80),
    pageNumber: z.number().int().positive(),
    text: z.string().max(12000),
    role: StructureCropRoleSchema.optional(),
  })
  .strict();
export type StructureTextCrop = z.infer<typeof StructureTextCropSchema>;

export const StructureCropOcrRequestSchema = z
  .object({
    storagePath: z.string().min(1),
    cropId: z.string().min(1).max(80),
  })
  .strict();
export type StructureCropOcrRequest = z.infer<typeof StructureCropOcrRequestSchema>;

export const StructureCropOcrResultSchema = z
  .object({
    cropId: z.string(),
    text: z.string().max(12000),
    confidence: z.number().min(0).max(100).nullable(),
    warnings: z.array(z.string()),
  })
  .strict();
export type StructureCropOcrResult = z.infer<typeof StructureCropOcrResultSchema>;

/**
 * A bounded group shares one OCR worker. Keeping failures beside their crop lets the browser
 * preserve successful readings instead of throwing away a whole batch after one bad image.
 */
export const StructureCropOcrBatchRequestSchema = z
  .object({
    crops: z.array(StructureCropOcrRequestSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.crops.map((crop) => crop.cropId)).size !== value.crops.length)
      ctx.addIssue({ code: 'custom', message: 'Crop IDs must be unique.', path: ['crops'] });
    if (new Set(value.crops.map((crop) => crop.storagePath)).size !== value.crops.length)
      ctx.addIssue({ code: 'custom', message: 'Crop uploads must be unique.', path: ['crops'] });
  });
export type StructureCropOcrBatchRequest = z.infer<typeof StructureCropOcrBatchRequestSchema>;

export const StructureCropOcrBatchItemSchema = z
  .object({
    cropId: z.string().min(1).max(80),
    result: StructureCropOcrResultSchema.nullable(),
    error: z.string().min(1).nullable(),
  })
  .strict()
  .refine((item) => (item.result === null) !== (item.error === null), {
    message: 'An OCR batch item must contain exactly one result or error.',
  });
export type StructureCropOcrBatchItem = z.infer<typeof StructureCropOcrBatchItemSchema>;

export const StructureCropOcrBatchResultSchema = z
  .object({ crops: z.array(StructureCropOcrBatchItemSchema).min(1).max(12) })
  .strict();
export type StructureCropOcrBatchResult = z.infer<typeof StructureCropOcrBatchResultSchema>;
