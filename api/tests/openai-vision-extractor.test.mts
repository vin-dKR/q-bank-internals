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

function pentagon(id: string): unknown {
  return {
    id, readability: 'clear',
    atoms: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, element: 'C', x: 500 + 200 * Math.cos(2 * Math.PI * index / 5), y: 500 + 200 * Math.sin(2 * Math.PI * index / 5), charge: 0, isotope: 0, hydrogens: null })),
    bonds: Array.from({ length: 5 }, (_, index) => ({ begin: index + 1, end: ((index + 1) % 5) + 1, order: 1, stereo: 'none' })),
    rings: [[1, 2, 3, 4, 5]], notes: [],
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
  const first = '{"questions":[{"question_text":"<smiles>C1CCCCC1</smiles>"}]}';
  const audited = JSON.stringify({ molecules: [pentagon('/questions/0/question_text/smiles/0')], source_counts: [{ field_path: '/questions/0/question_text', observed_molecule_count: 1 }] });
  const instance = extractor([reply(first), reply(audited)]);
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };

  const result = await instance.call('read the page', Buffer.from('page'), usage);

  assert.equal(result.content, '{"questions":[{"question_text":"<smiles>C1CCCC1</smiles>"}]}');
  assert.equal(usage.callCount, 2);
});

void test('chemistry audit cannot replace a question with an empty object or erase its options', async () => {
  const first = '{"questions":[{"question_number":3,"question_text":"Identify <smiles>c1ccccc1</smiles>","options":["(A) Benzene"]}]}';
  for (const audited of ['{}', '{"questions":[]}', '{"patches":[]}']) {
    const instance = extractor([reply(first), reply(audited)]);
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
    assert.equal((await instance.call('read', Buffer.from('page'), usage)).content, first);
  }
});

void test('optional chemistry audit outage retains a successful primary read', async () => {
  const first = '{"questions":[{"question_text":"<smiles>c1ccccc1</smiles>"}]}';
  const instance = extractor([reply(first)]);
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
  assert.equal((await instance.call('read', Buffer.from('page'), usage)).content, first);
});
