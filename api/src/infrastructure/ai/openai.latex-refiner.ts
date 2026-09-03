import { OpenAI } from 'openai';
import { errors } from '../../shared/errors/error-catalog.js';
import type { LatexRefinement, LatexRefiner } from '../../modules/questions/index.js';
import { fillTokens, resolvePrompt, type PromptOverrides } from '../../modules/prompts/index.js';

/**
 * {@link LatexRefiner} backed by OpenAI — ported from the standalone question-editor, but run on the
 * SERVER (the API key never reaches the browser). Uses a small JSON-mode model. The system role and the
 * wrapping instructions are the editable `latexSystem` / `latexUser` prompts; `{text}` is filled with
 * the field's content here.
 */
export class OpenAiLatexRefiner implements LatexRefiner {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly loadPromptOverrides: () => Promise<PromptOverrides>,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async refine(text: string): Promise<LatexRefinement> {
    const overrides = await this.loadPromptOverrides();
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: resolvePrompt(overrides, 'latexSystem') },
        { role: 'user', content: fillTokens(resolvePrompt(overrides, 'latexUser'), { text }) },
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
