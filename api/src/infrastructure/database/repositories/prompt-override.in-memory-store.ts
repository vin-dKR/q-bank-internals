import type { PromptKey } from '@ingest/contracts';
import type { PromptOverrideStore } from '../../../modules/prompts/index.js';

/** In-memory {@link PromptOverrideStore} (dev). Overrides live for the process lifetime only. */
export class InMemoryPromptOverrideStore implements PromptOverrideStore {
  private readonly store = new Map<PromptKey, string>();

  findAll(): Promise<Partial<Record<PromptKey, string>>> {
    return Promise.resolve(Object.fromEntries(this.store) as Partial<Record<PromptKey, string>>);
  }

  upsert(key: PromptKey, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  remove(key: PromptKey): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}
