import { z } from 'zod';
import { JsonStreamErrorSchema } from '../common/json-stream.schema.js';
import { DetectStructureResultSchema } from './structure-detection.schema.js';

export const StructureDetectionProgressSchema = z
  .object({
    completed: z.number().int().min(0).max(1000),
    total: z.number().int().min(1).max(1000),
    phase: z.enum(['extracting', 'building']),
  })
  .strict()
  .refine((value) => value.completed <= value.total, 'Completed crops cannot exceed the total.');
export type StructureDetectionProgress = z.infer<typeof StructureDetectionProgressSchema>;

export const StructureDetectionStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), progress: StructureDetectionProgressSchema }).strict(),
  z.object({ type: z.literal('result'), data: DetectStructureResultSchema }).strict(),
  JsonStreamErrorSchema,
]);
export type StructureDetectionStreamEvent = z.infer<typeof StructureDetectionStreamEventSchema>;
