import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';

type FakeResponse = {
  choices: Array<{ finish_reason: 'stop' | 'length'; message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function reply(content: string): FakeResponse {
  return {
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function extractor(responses: FakeResponse[]): {
  call: (prompt: string, png: Buffer, usage: { promptTokens: number; completionTokens: number; totalTokens: number; callCount: number }) => Promise<{ content: string }>;
} {
  const instance = new OpenAiVisionExtractor('test-key', 'test-model', async () => ({}), async () => ({
    questionType: [],
    level: [],
  }));
  Object.assign(instance, {
    client: {
      chat: {
        completions: {
          create: async () => {
            const next = responses.shift();
            if (!next) throw new Error('Unexpected model call');
            return next;
          },
        },
      },
    },
  });
  return instance as unknown as {
    call: (prompt: string, png: Buffer, usage: { promptTokens: number; completionTokens: number; totalTokens: number; callCount: number }) => Promise<{ content: string }>;
  };
}

void test('ordinary extraction does not audit a response that emitted no SMILES tag', async () => {
  const instance = extractor([reply('{"questions":[]}')]);
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };

  const result = await instance.call('read the page', Buffer.from('page'), usage);

  assert.equal(result.content, '{"questions":[]}');
  assert.equal(usage.callCount, 1);
});

void test('ordinary extraction audits a response that emitted a SMILES tag', async () => {
  const first = '{"questions":[{"question_text":"<smiles>c1ccccc1</smiles>"}]}';
  const audited = '{"questions":[{"question_text":"<smiles>c1ccccc1</smiles>"}]}';
  const instance = extractor([reply(first), reply(audited)]);
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };

  const result = await instance.call('read the page', Buffer.from('page'), usage);

  assert.equal(result.content, audited);
  assert.equal(usage.callCount, 2);
});
