import type { AiTokenUsage } from '../usage/index.js';

/** Refined text plus the token spend the model reported producing it. */
export type LatexRefinement = { text: string; usage: AiTokenUsage };

/**
 * PORT (§3) for the one-click "Fix LaTeX": wrap the math in a piece of text with `\(...\)` inline
 * delimiters. Implemented with OpenAI in `infrastructure/ai` (ported from the question-editor), with
 * a null-object when no API key is configured. Returns the model's token {@link AiTokenUsage} so the
 * service can record spend alongside the extraction pipeline.
 */
export interface LatexRefiner {
  refine(text: string): Promise<LatexRefinement>;
}
