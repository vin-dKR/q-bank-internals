import { z } from 'zod';

/**
 * The module → chapter → section trail that travels with every file and every question — the key that
 * keeps the bank searchable. `module`/`chapter` may be EMPTY for a previous-year-questions (PYQ) paper:
 * a whole paper spans many subjects/chapters, so the operator can leave them blank and the question is
 * found by its PYQ provenance (`is_pyq` + paper metadata) instead. `section` is always present (the
 * unit's "All sections"). Ordinary (non-PYQ) uploads still require module/chapter — enforced at the
 * upload boundary (see {@link ChapterUploadMetadataSchema}), not here, so the stored shape stays one type.
 */
export const SourcePathSchema = z.object({
  module: z.string(),
  chapter: z.string(),
  section: z.string().min(1),
});
export type SourcePath = z.infer<typeof SourcePathSchema>;
