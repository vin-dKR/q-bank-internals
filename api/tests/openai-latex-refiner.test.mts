import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiLatexRefiner } from '../src/infrastructure/ai/openai.latex-refiner.js';

void test('LaTeX AI prompt includes current scanner findings alongside editable instructions', async () => {
  const refiner = new OpenAiLatexRefiner('test-key', 'test-model', async () => ({
    latexSystem: 'Custom system instructions',
    latexUser: 'Fix the LaTeX in {text}',
  }));
  type ModelRequest = { messages: { content: string }[] };
  const requests: ModelRequest[] = [];
  Object.assign(refiner, { client: { chat: { completions: { create: async (input: ModelRequest) => {
    requests.push(input);
    return { choices: [{ message: { content: '{"refined_text":"fixed"}' } }], usage: null };
  } } } } });

  const result = await refiner.refine(String.raw`\(\frac{1}{2}`, [{
    kind: 'latex_unclosed_delimiter', detail: 'Opened \\( without a closing pair.',
  }]);

  assert.equal(result.text, 'fixed');
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.messages[0]?.content, 'Custom system instructions');
  assert.match(request.messages[1]?.content ?? '', /Fix the LaTeX in/);
  assert.match(request.messages[1]?.content ?? '', /latex_unclosed_delimiter/);
  assert.match(request.messages[1]?.content ?? '', /without a closing pair/);
  assert.match(request.messages[1]?.content ?? '', /never copy the findings into it/);
});
