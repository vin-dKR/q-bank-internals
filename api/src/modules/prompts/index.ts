// Public surface of the prompts module (§4). Others import from here, never from internals.
export { PromptService } from './prompts.service.js';
export { createPromptsRouter } from './prompts.routes.js';
export type { PromptOverrideStore } from './prompts.repository.js';
export {
  PROMPT_DEFAULTS,
  PROMPT_META,
  fillTokens,
  resolvePrompt,
  type PromptOverrides,
} from './prompt-catalog.js';
