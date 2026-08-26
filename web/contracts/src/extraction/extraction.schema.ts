import { z } from 'zod';

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
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  model: z.string(),
  questionsFound: z.number().int().nonnegative(),
  pagesTotal: z.number().int().nonnegative(),
  pagesDone: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;
