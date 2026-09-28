import { z } from 'zod';

export const LatexIssueSchema = z.object({
  key: z.string(),
  questionId: z.string().nullable(),
  questionNumber: z.number().nullable(),
  field: z.string(),
  kind: z.string(),
  detail: z.string(),
  automatic: z.boolean(),
});
export type LatexIssue = z.infer<typeof LatexIssueSchema>;

export const LatexScanSchema = z.object({
  documentId: z.string(),
  issues: z.array(LatexIssueSchema),
  questionCount: z.number(),
  automaticFields: z.number(),
  aiFields: z.number(),
});
export type LatexScan = z.infer<typeof LatexScanSchema>;

export const LatexFixRequestSchema = z.object({ documentId: z.string().min(1) });
export const LatexAiBatchRequestSchema = LatexFixRequestSchema.extend({
  keys: z.array(z.string().min(1)).min(1).max(5),
});

export const LatexFixResultSchema = z.object({
  updatedFields: z.number(),
  failed: z.array(z.object({ key: z.string(), message: z.string() })),
});
export type LatexFixResult = z.infer<typeof LatexFixResultSchema>;

export const LatexFieldCheckRequestSchema = z.object({
  field: z.string().min(1).max(100),
  text: z.string().max(100_000),
});
export type LatexFieldCheckRequest = z.infer<typeof LatexFieldCheckRequestSchema>;

export const LatexFieldCheckResultSchema = z.object({
  field: z.string(),
  issues: z.array(z.object({
    kind: z.string(),
    field: z.string().nullable(),
    detail: z.string(),
  })),
});
export type LatexFieldCheckResult = z.infer<typeof LatexFieldCheckResultSchema>;
