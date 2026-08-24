import { OpenAI } from 'openai';
import { errors } from '../../shared/errors/error-catalog.js';
import type { LatexRefinement, LatexRefiner } from '../../modules/questions/index.js';

const SYSTEM_PROMPT =
  'You are a LaTeX formatting expert. You wrap math and physical quantities in a passage using ' +
  'inline LaTeX delimiters \\(...\\). You never change, add, or remove any words — you only add ' +
  'delimiters and normalise math notation.';

/**
 * The user prompt. Wraps math AND physical quantities (number + unit) in `\(...\)`, with units inside
 * `\text{...}`, and forbids adding/removing words. Returns `{ "refined_text": "…" }`.
 */
function userPrompt(text: string): string {
  return `Wrap every mathematical expression and physical quantity in the text below using ONLY inline delimiters \\(...\\).

RULES
1. Wrap math: fractions, roots, powers/subscripts, Greek letters, equations, comparisons, symbols.
2. A physical quantity (a number followed by a unit, e.g. "m/sec", "kg", "m/s^2", "N", "°C") is math. Wrap the WHOLE thing — number AND unit — in one \\(...\\) group, and put the unit inside \\text{...}. Example: -3 m/sec  ->  \\(-3\\ \\text{m/sec}\\)
3. Units ALWAYS go inside \\text{...}, and every \\text{...} MUST sit inside \\(...\\). Never output a bare \\text{...} outside \\(...\\).
4. If the text already contains delimiters ($...$, \\[...\\], [...]) or a bare \\text{...}, convert them to correct \\(...\\) form.
5. Do NOT add, remove, reword, explain, or translate any text. Only wrap. Plain prose stays exactly as written, only its math/quantities get wrapped.
6. Preserve all spacing and punctuation outside the wrapped math.
7. If a value already sits inside correct \\(...\\), leave it; just fix the unit to \\text{...} if needed.

EXAMPLES
Input:  "6 \\text{ m/sec}"          Output: "\\(6\\ \\text{m/sec}\\)"
Input:  "-3 m/sec"                  Output: "\\(-3\\ \\text{m/sec}\\)"
Input:  "5 kg"                      Output: "\\(5\\ \\text{kg}\\)"
Input:  "x^2 + 5x - 6 = 0"          Output: "\\(x^2 + 5x - 6 = 0\\)"
Input:  "v = 20 m/s"                Output: "\\(v = 20\\ \\text{m/s}\\)"
Input:  "The ball moves at 9.8 m/s^2 downward"   Output: "The ball moves at \\(9.8\\ \\text{m/s}^2\\) downward"

Input text: "${text}"

Return valid JSON only: { "refined_text": "..." }`;
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

  async refine(text: string): Promise<LatexRefinement> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(text) },
      ],
    });
    const usage: LatexRefinement['usage'] = {
      model: this.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      callCount: 1,
    };
    const content = response.choices[0]?.message.content ?? '{}';
    try {
      const parsed: unknown = JSON.parse(content);
      const refined = (parsed as { refined_text?: unknown }).refined_text;
      return { text: typeof refined === 'string' ? refined : text, usage };
    } catch {
      throw errors.extractionFailed('The AI returned malformed JSON while refining LaTeX.');
    }
  }
}
