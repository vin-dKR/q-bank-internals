import type { z } from 'zod';
import { errors } from '../errors/error-catalog.js';

/**
 * The one boundary where untyped HTTP input becomes a typed value (§8: trust types *after* the
 * boundary, validate *at* it). Controllers parse `req.body`/`req.query`/params through this; it
 * returns the concretely-typed value or throws a catalog validation error. No `any`, no casts.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw errors.validation(result.error.flatten());
  }
  return result.data as z.infer<S>;
}
