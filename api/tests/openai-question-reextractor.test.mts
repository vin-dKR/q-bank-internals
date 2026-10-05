import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiQuestionReExtractor } from '../src/infrastructure/ai/openai.question-reextractor.js';

type FakeResponse = {
  choices: Array<{ finish_reason: 'stop' | 'length'; message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function reply(content: unknown): FakeResponse {
  return {
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function reExtractor(create: () => Promise<FakeResponse>): OpenAiQuestionReExtractor {
  const extractor = new OpenAiQuestionReExtractor('test-key', 'test-model', async () => ({}));
  Object.assign(extractor, { client: { chat: { completions: { create } } } });
  return extractor;
}

const matrixColumns = [
  { title: 'Column I', entries: [{ label: 'a', body: 'First' }, { label: 'b', body: 'Second' }] },
  { title: 'Column II', entries: [{ label: 'i', body: 'One' }, { label: 'ii', body: 'Two' }] },
];

test('re-extraction preserves every printed matrix label and does not run a chemistry audit', async () => {
  let calls = 0;
  const extractor = reExtractor(async () => {
    calls += 1;
    return reply({
      stem: 'Match the columns.',
      columns: matrixColumns,
      match: { a: ['i'], b: ['ii'] },
      answer: '5',
      options: [
        { label: '1', body: '(i), (ii)' },
        { label: '2', body: '(ii), (i)' },
        { label: '3', body: '(i), (i)' },
        { label: '4', body: '(ii), (ii)' },
        { label: '5', body: '(i), (ii)', is_correct: true },
        { label: 'F', body: 'None of these' },
      ],
    });
  });

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 123,
    stemHint: 'Match the columns',
    questionType: 'matrix',
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.options.map((option) => option.label), ['1', '2', '3', '4', '5', 'F']);
  assert.equal(result.answer, '5');
  assert.ok(result.options.every((option) => option.generated === undefined));
});

test('re-extraction does not invent an A–D panel when a matrix page has no printed choices', async () => {
  const extractor = reExtractor(async () => reply({
    stem: 'Match the columns.',
    columns: matrixColumns,
    match: { a: ['i'], b: ['ii'] },
    answer: 'a → i; b → ii',
    options: [],
  }));

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 124,
    stemHint: 'Match the columns',
    questionType: 'matrix',
  });

  assert.deepEqual(result.options, []);
  assert.equal(result.answer, 'a → i; b → ii');
});

test('a failed optional chemistry audit preserves an otherwise valid primary re-extraction', async () => {
  let calls = 0;
  const extractor = reExtractor(async () => {
    calls += 1;
    if (calls === 2) throw new Error('temporary model outage');
    return reply({
      stem: 'Identify <smiles>c1ccccc1</smiles>.',
      options: [{ label: 'A', body: 'Benzene' }],
      answer: 'A',
    });
  });

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 125,
    stemHint: 'Identify the structure',
    questionType: 'single_correct',
  });

  assert.equal(calls, 2);
  assert.equal(result.stem, 'Identify <smiles>c1ccccc1</smiles>.');
  assert.equal(result.answer, 'A');
});
