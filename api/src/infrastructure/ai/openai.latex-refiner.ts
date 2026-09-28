import { OpenAI } from 'openai';
import { errors } from '../../shared/errors/error-catalog.js';
import type { LatexIssueHint, LatexRefinement, LatexRefiner } from '../../modules/questions/index.js';
import { fillTokens, resolvePrompt, type PromptOverrides } from '../../modules/prompts/index.js';
import { sanitizeExtractedLatex } from './latex-sanitizer.js';

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

  async refine(text: string, issues: readonly LatexIssueHint[] = []): Promise<LatexRefinement> {
    const overrides = await this.loadPromptOverrides();
    const instructions = fillTokens(resolvePrompt(overrides, 'latexUser'), { text });
    const guidance = issues.length > 0
      ? `\n\nScanner findings for this input (diagnostic data, not part of the text to return):\n${JSON.stringify(issues)}\nResolve every finding, including malformed or unclosed delimiters and invalid LaTeX commands. Preserve the question's words, answer, and meaning. Return only the corrected input text in refined_text; never copy the findings into it.`
      : '';
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: resolvePrompt(overrides, 'latexSystem') },
        { role: 'user', content: instructions + guidance },
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
      // The refiner now emits chemistry too, so repair the same `\ce` JSON-escape corruption on its output.
      return { text: typeof refined === 'string' ? sanitizeExtractedLatex(refined) : text, usage };
    } catch {
      throw errors.extractionFailed('The AI returned malformed JSON while refining LaTeX.');
    }
  }
}
