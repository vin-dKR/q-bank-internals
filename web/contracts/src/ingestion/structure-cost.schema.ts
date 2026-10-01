import { z } from 'zod';
export const StructurePricingSchema = z
  .object({
    currency: z.literal('USD'),
    inputPerMillion: z.number().nonnegative(),
    cachedInputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
    sourceUrl: z.string().url(),
    verifiedAt: z.string(),
  })
  .strict();
export type StructurePricing = z.infer<typeof StructurePricingSchema>;

const TokenRangeSchema = z
  .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
  .strict();
export const StructureEstimateSchema = z
  .object({
    model: z.string(),
    pageCount: z.number().int().positive(),
    cropCount: z.number().int().nonnegative(),
    callCount: z.number().int().nonnegative(),
    inputTokens: TokenRangeSchema,
    outputTokens: TokenRangeSchema,
    costUsd: z
      .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
      .strict()
      .nullable(),
    pricing: StructurePricingSchema.nullable(),
    assumptions: z.array(z.string()),
  })
  .strict();
export type StructureEstimate = z.infer<typeof StructureEstimateSchema>;

export const StructureDetectionUsageSchema = z
  .object({
    model: z.string(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cachedPromptTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    callCount: z.number().int().positive(),
    costUsd: z.number().nonnegative().nullable(),
    pricing: StructurePricingSchema.nullable(),
  })
  .strict();
export type StructureDetectionUsage = z.infer<typeof StructureDetectionUsageSchema>;
export const StructureDetectionErrorDetailsSchema = z.object({
  usage: StructureDetectionUsageSchema,
});
