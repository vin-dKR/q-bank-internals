import type { PromptDefinition, PromptKey } from '@ingest/contracts';
import { PROMPT_KEYS } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { PROMPT_DEFAULTS, PROMPT_META, type PromptOverrides } from './prompt-catalog.js';
import type { PromptOverrideStore } from './prompts.repository.js';

/** Cache the overrides map briefly so a multi-page extraction doesn't re-read the store per page. */
const CACHE_TTL_MS = 30_000;

/**
 * Owns the editable-prompts feature: lists each prompt with its default + current value, saves an
 * override (after checking it keeps every required `{token}`), and resets one to its default. Also
 * hands the prompt builders the effective overrides map — cached with a short TTL so an edit takes
 * effect within ~30s across serverless instances (and immediately on the instance that saved it).
 */
export class PromptService {
  private cache: { at: number; overrides: PromptOverrides } | null = null;

  constructor(private readonly store: PromptOverrideStore) {}

  /** The effective overrides map for the prompt builders, briefly cached to avoid a per-page DB read. */
  async overrides(): Promise<PromptOverrides> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.overrides;
    const overrides = await this.store.findAll();
    this.cache = { at: now, overrides };
    return overrides;
  }

  /** Every editable prompt with its default + current effective value, for the settings screen. */
  async list(): Promise<PromptDefinition[]> {
    const overrides = await this.store.findAll();
    return PROMPT_KEYS.map((key) => this.definition(key, overrides[key]));
  }

  /** Save a new value for one prompt after checking it keeps every required `{token}`. */
  async update(key: PromptKey, value: string): Promise<PromptDefinition> {
    const missing = PROMPT_META[key].tokens.filter((token) => !value.includes(`{${token}}`));
    if (missing.length > 0) throw errors.promptMissingTokens(key, missing);
    await this.store.upsert(key, value);
    this.cache = null;
    return this.definition(key, value);
  }

  /** Drop a prompt's override, returning it to the code default. */
  async reset(key: PromptKey): Promise<PromptDefinition> {
    await this.store.remove(key);
    this.cache = null;
    return this.definition(key, undefined);
  }

  /** Assemble the operator-facing view of one prompt from its metadata, default, and (optional) override. */
  private definition(key: PromptKey, override: string | undefined): PromptDefinition {
    return {
      key,
      label: PROMPT_META[key].label,
      description: PROMPT_META[key].description,
      tokens: PROMPT_META[key].tokens,
      default: PROMPT_DEFAULTS[key],
      value: override ?? PROMPT_DEFAULTS[key],
      overridden: override !== undefined,
    };
  }
}
