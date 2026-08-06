import { z } from 'zod';

/** Request to start extraction on a registered document. */
export const StartExtractionSchema = z.object({
  documentId: z.string().min(1),
});
export type StartExtraction = z.infer<typeof StartExtractionSchema>;

/** Progress of an extraction job, polled by the web app while it runs. */
export const ExtractionJobSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  model: z.string(),
  questionsFound: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;
