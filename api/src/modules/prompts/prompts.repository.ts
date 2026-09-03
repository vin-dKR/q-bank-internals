import type { PromptKey } from '@ingest/contracts';

/**
 * Persistence PORT (§3) for operator prompt overrides. Empty by default — a key with no row means the
 * builder uses the code default. Implemented in-memory (dev) or Prisma (prod).
 */
export interface PromptOverrideStore {
  /** Every stored override, as a `key → value` map (keys with no override are simply absent). */
  findAll(): Promise<Partial<Record<PromptKey, string>>>;
  /** Insert or replace the override for a key. */
  upsert(key: PromptKey, value: string): Promise<void>;
  /** Remove a key's override, returning that prompt to its code default. A no-op when none is stored. */
  remove(key: PromptKey): Promise<void>;
}
