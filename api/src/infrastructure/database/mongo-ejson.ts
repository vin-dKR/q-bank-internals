import { z } from 'zod';

/**
 * Shared helpers for reading the main bank's `Question` collection through Prisma's `$runCommandRaw`.
 * That path returns MongoDB Extended JSON (numbers wrapped as `{ $numberInt }`, ids as `{ $oid }`),
 * so every raw reader needs the same coercions and the same "pull `cursor.firstBatch`" step. Defined
 * once here (used by both the bank fix store and the catalog browse store) so the coercions never
 * drift between the two readers of the same collection (§6.2).
 */

/** `$runCommandRaw` returns extended JSON: numbers may be wrapped as `{ $numberInt: "1" }` etc. */
export const ejsonNumber = z.preprocess((value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const raw = record.$numberInt ?? record.$numberLong ?? record.$numberDouble;
    if (typeof raw === 'string') return Number(raw);
  }
  return value;
}, z.number());

/** Booleans stored as 1/"true"/true all mean true; anything else is false. */
export const ejsonBool = z.preprocess(
  (value) => value === true || value === 1 || value === '1' || value === 'true',
  z.boolean(),
);

/** The Mongo `_id` comes back as `{ $oid: "…" }`; unwrap it to the hex string. */
export const oid = z.preprocess((value) => {
  if (value && typeof value === 'object') {
    const hex = (value as Record<string, unknown>).$oid;
    if (typeof hex === 'string') return hex;
  }
  return value;
}, z.string());

/** Escape user text so it is matched as a literal substring by `$regex`, never as a pattern. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pull the `cursor.firstBatch` array out of a raw `find`/`aggregate` reply (empty when absent). */
export function firstBatch(result: unknown): unknown[] {
  const cursor = (result as { cursor?: { firstBatch?: unknown } }).cursor;
  const batch = cursor?.firstBatch;
  return Array.isArray(batch) ? batch : [];
}
