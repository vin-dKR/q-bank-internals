import OpenAI from 'openai';
import { errors } from '../../shared/errors/error-catalog.js';
import type { LatexRefiner } from '../../modules/questions/index.js';

const SYSTEM_PROMPT =
  'You are a LaTeX formatting expert. Your job is to find and correctly wrap all LaTeX/math ' +
  'expressions using inline LaTeX delimiters.';

/** The user prompt, ported from question-editor's aiService. Returns `{ "refined_text": "…" }`. */
function userPrompt(text: string): string {
  return `Format LaTeX expressions in the provided text. Use inline math delimiters only: \\(...\\)

Rules:
1. Detect all LaTeX or math expressions (fractions, roots, Greek letters, sub/superscripts, equations, symbols, etc.).
2. Wrap ONLY the math expressions using inline delimiters: \\(...\\)
3. Do NOT wrap full sentences — only the math parts.
4. Replace any other math delimiters ($...$, \\[...\\], [...], etc.) with \\(...\\)
5. Do NOT add or remove any text — only wrap the math where necessary.
6. Preserve spacing, punctuation, and formatting outside math.

Input text: "${text}"

Return valid JSON: { "refined_text": "..." }`;
}

/**
 * {@link LatexRefiner} backed by OpenAI — ported from the standalone question-editor, but run on the
 * SERVER (the API key never reaches the browser). Uses a small JSON-mode model.
 */
export class OpenAiLatexRefiner implements LatexRefiner {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = 'gpt-4o-mini',
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async refine(text: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(text) },
      ],
    });
    const content = response.choices[0]?.message.content ?? '{}';
    try {
      const parsed: unknown = JSON.parse(content);
      const refined = (parsed as { refined_text?: unknown }).refined_text;
      return typeof refined === 'string' ? refined : text;
    } catch {
      throw errors.extractionFailed('The AI returned malformed JSON while refining LaTeX.');
    }
  }
}
