import { z } from 'zod';

/**
 * The AI prompts an operator may edit from the frontend to tune extraction quality without a redeploy.
 * Each key names one editable block; the server composes the final prompt from the (possibly overridden)
 * block plus fixed structural parts (JSON shapes, per-type rules chosen at runtime). Adding a key here
 * plus a matching catalog entry + one builder line makes another prompt editable.
 */
export const PROMPT_KEYS = [
  'extraction',
  'inlineAnswer',
  'pyq',
  'detection',
  'answerKey',
  'solution',
  'latexSystem',
  'latexUser',
  // The data-quality "fix with AI" prompts: one system role plus a block per field it may fill in.
  'qualityFixSystem',
  'qualityChapter',
  'qualityTopic',
  'qualityAnswer',
  'qualitySolution',
  'qualityLevel',
  'qualityTypeLock',
  'qualityStructure',
] as const;
export const PromptKeySchema = z.enum(PROMPT_KEYS);
export type PromptKey = z.infer<typeof PromptKeySchema>;

/**
 * One editable prompt as the settings screen sees it: what it is, the `{token}` placeholders its text
 * must keep, the code default, and the current effective `value` (the override if set, else the default).
 */
export const PromptDefinitionSchema = z.object({
  key: PromptKeySchema,
  label: z.string(),
  description: z.string(),
  /** Placeholders the server substitutes at run time (e.g. `imgWidth`); a save that drops one is rejected. */
  tokens: z.array(z.string()),
  /** The hard-coded default text — what "Reset" restores. */
  default: z.string(),
  /** The current effective text: the saved override when present, otherwise the default. */
  value: z.string(),
  /** True when an override is stored (i.e. `value` differs from `default`). */
  overridden: z.boolean(),
});
export type PromptDefinition = z.infer<typeof PromptDefinitionSchema>;

export const PromptListSchema = z.array(PromptDefinitionSchema);

/** Save a new value for one prompt. Blank/whitespace-only is rejected (use reset to return to default). */
export const UpdatePromptSchema = z.object({
  value: z.string().min(1),
});
export type UpdatePrompt = z.infer<typeof UpdatePromptSchema>;
