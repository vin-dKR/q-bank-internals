import type { Request } from 'express';
import { errors } from '../errors/error-catalog.js';

/**
 * Reads a required route param as a definite `string`. `noUncheckedIndexedAccess` types params as
 * possibly-undefined; this is the one place we assert presence, throwing a validation error rather
 * than letting `undefined` leak downstream. Controllers use this instead of `req.params.x`.
 */
export function requiredParam(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined || value === '') {
    throw errors.validation({ param: name, message: 'Missing required route parameter.' });
  }
  return value;
}
