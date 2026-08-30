import { z } from 'zod';

/**
 * The module → chapter → section trail that travels with every file and every question. Losing it
 * is what makes the bank unsearchable (see pipeline stage handoffs), so it is one shape, validated
 * everywhere a document or question crosses the boundary.
 *
 * `module`/`chapter` may be empty for PYQ (previous-year-question) uploads: those are organized by
 * exam/year, not by a coaching module or chapter, so they legitimately carry no module/chapter.
 * `section` always has a value (defaults to "All sections") and stays required.
 */
export const SourcePathSchema = z.object({
  module: z.string(),
  chapter: z.string(),
  section: z.string().min(1),
});
export type SourcePath = z.infer<typeof SourcePathSchema>;
