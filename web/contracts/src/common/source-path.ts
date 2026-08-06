import { z } from 'zod';

/**
 * The module → chapter → section trail that MUST travel with every file and every question.
 * Losing it is what makes the bank unsearchable (see pipeline stage handoffs), so it is one shape,
 * validated everywhere a document or question crosses the boundary.
 */
export const SourcePathSchema = z.object({
  module: z.string().min(1),
  chapter: z.string().min(1),
  section: z.string().min(1),
});
export type SourcePath = z.infer<typeof SourcePathSchema>;
