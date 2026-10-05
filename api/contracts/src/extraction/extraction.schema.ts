import { z } from 'zod';
import { PaperMetadataSchema } from '../common/paper-metadata.js';

/**
 * Result of AI-filling the paper-details form from a PYQ paper's header. The request is a multipart
 * upload of ONE rendered page image (the paper's first/header page, rasterized in the browser before
 * upload) — no JSON body — and the server returns the paper fields it could read, blank where the
 * header did not print them. The operator reviews and corrects before uploading.
 */
export const ExtractPaperMetadataResultSchema = z.object({
  paper: PaperMetadataSchema,
});
export type ExtractPaperMetadataResult = z.infer<typeof ExtractPaperMetadataResultSchema>;

/** Request to start extraction on a registered document. */
export const StartExtractionSchema = z.object({
  documentId: z.string().min(1),
});
export type StartExtraction = z.infer<typeof StartExtractionSchema>;

/**
 * Progress of an extraction job, polled by the web app while it runs. `pagesTotal`/`pagesDone` back
 * the live status bar (count + %); `questionsFound` grows per page and is finalised at the end.
 * `cancelled` is a terminal state the operator triggers via the Cancel action (distinct from a
 * `failed` timeout/error), after which the document returns to a re-runnable state.
 */
export const ExtractionJobSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  status: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled']),
  model: z.string(),
  questionsFound: z.number().int().nonnegative(),
  pagesTotal: z.number().int().nonnegative(),
  pagesDone: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;
