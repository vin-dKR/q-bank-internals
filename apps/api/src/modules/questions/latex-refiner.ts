/**
 * PORT (§3) for the one-click "Fix LaTeX": wrap the math in a piece of text with `\(...\)` inline
 * delimiters. Implemented with OpenAI in `infrastructure/ai` (ported from the question-editor), with
 * a null-object when no API key is configured.
 */
export interface LatexRefiner {
  refine(text: string): Promise<string>;
}
