import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiLatexRefiner } from '../src/infrastructure/ai/openai.latex-refiner.js';

test('LaTeX AI prompt includes current scanner findings alongside editable instructions', async () => {
  const refiner = new OpenAiLatexRefiner('test-key', 'test-model', async () => ({
    latexSystem: 'Custom system instructions',
    latexUser: 'Fix the LaTeX in {text}',
  }));
  let request: { messages: { content: string }[] } | null = null;
  Object.assign(refiner, { client: { chat: { completions: { create: async (input: typeof request) => {
    request = input;
    return { choices: [{ message: { content: '{"refined_text":"fixed"}' } }], usage: null };
  } } } } });

  const result = await refiner.refine(String.raw`\(\frac{1}{2}`, [{
    kind: 'latex_unclosed_delimiter', detail: 'Opened \\( without a closing pair.',
  }]);

  assert.equal(result.text, 'fixed');
  assert.equal(request?.messages[0]?.content, 'Custom system instructions');
  assert.match(request?.messages[1]?.content ?? '', /Fix the LaTeX in/);
  assert.match(request?.messages[1]?.content ?? '', /latex_unclosed_delimiter/);
  assert.match(request?.messages[1]?.content ?? '', /without a closing pair/);
  assert.match(request?.messages[1]?.content ?? '', /never copy the findings into it/);
});
