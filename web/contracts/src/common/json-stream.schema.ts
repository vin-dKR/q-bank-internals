import { z } from 'zod';

export const JSON_STREAM_CONTENT_TYPE = 'application/x-ndjson';
export const JsonStreamErrorSchema = z
  .object({
    type: z.literal('error'),
    error: z
      .object({
        code: z.string(),
        status: z.number().int().min(400).max(599),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
