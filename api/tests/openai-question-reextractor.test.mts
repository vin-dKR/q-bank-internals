import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenAiQuestionReExtractor } from '../src/infrastructure/ai/openai.question-reextractor.js';
import { reExtractQuestionPrompt } from '../src/infrastructure/ai/prompts/extraction-prompts.js';

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

function reExtractor(create: (request?: unknown) => Promise<FakeResponse>): OpenAiQuestionReExtractor {
  const extractor = new OpenAiQuestionReExtractor('test-key', 'test-model', async () => ({}));
  Object.assign(extractor, { client: { chat: { completions: { create } } } });
  return extractor;
}

const matrixColumns = [
  { title: 'Column I', entries: [{ label: 'a', body: 'First' }, { label: 'b', body: 'Second' }] },
  { title: 'Column II', entries: [{ label: 'i', body: 'One' }, { label: 'ii', body: 'Two' }] },
];

function sourceRing(id: string, size = 5): unknown {
  return {
    id, readability: 'clear',
    atoms: Array.from({ length: size }, (_, index) => ({ id: index + 1, element: 'C', x: 500 + 200 * Math.cos(2 * Math.PI * index / size), y: 500 + 200 * Math.sin(2 * Math.PI * index / size), charge: 0, isotope: 0, hydrogens: null })),
    bonds: Array.from({ length: size }, (_, index) => ({ begin: index + 1, end: ((index + 1) % size) + 1, order: 1, stereo: 'none' })),
    rings: [Array.from({ length: size }, (_, index) => index + 1)], notes: [],
  };
}

void test('interactive molecular re-extraction derives SMILES from independent topology while preserving other fields', async () => {
  const responses = [
    { stem: 'Identify <smiles>C1CCCCC1</smiles>.', options: [{ label: 'F', body: 'A product' }], answer: 'F' },
    { molecules: [sourceRing('/stem/smiles/0')], source_counts: [{ field_path: '/stem', observed_molecule_count: 1 }] },
  ];
  const requests: unknown[] = [];
  const extractor = reExtractor(async (request) => { requests.push(request); return reply(responses.shift()); });
  const result = await extractor.reExtract({ png: Buffer.from('page'), questionNumber: 3, printedLabel: 'B-3', stemHint: 'Identify', questionType: 'single_correct' });
  assert.equal(result.stem, 'Identify <smiles>C1CCCC1</smiles>.');
  assert.equal(result.answer, 'F');
  assert.deepEqual(result.options.map(({ label, body }) => ({ label, body })), [{ label: 'F', body: 'A product' }]);
  assert.equal(result.molecularAudits?.[0]?.status, 'corrected');
  assert.doesNotMatch(JSON.stringify(requests[1]), /C1CCCCC1/);
});

void test('legacy batch re-extraction keeps molecular audits only for the selected printed identity', async () => {
  const responses = [
    { questions: [
      { question_number: 'A-3', question_text: 'First <smiles>C1CCCC1</smiles>.', options: [] },
      { question_number: 'B-3', question_text: 'Target <smiles>C1CCCCC1</smiles>.', options: [] },
    ] },
    { molecules: [sourceRing('/questions/0/question_text/smiles/0', 6), sourceRing('/questions/1/question_text/smiles/0')], source_counts: [
      { field_path: '/questions/0/question_text', observed_molecule_count: 1 },
      { field_path: '/questions/1/question_text', observed_molecule_count: 1 },
    ] },
  ];
  const extractor = reExtractor(async () => reply(responses.shift()));
  const result = await extractor.reExtract({ png: Buffer.from('page'), questionNumber: 3, printedLabel: 'B-3', stemHint: 'Target', questionType: 'subjective' });
  assert.equal(result.stem, 'Target <smiles>C1CCCC1</smiles>.');
  assert.equal(result.molecularAudits?.length, 1);
  const audit = result.molecularAudits[0];
  assert.ok(audit);
  assert.equal(audit.candidateId, '/questions/1/question_text/smiles/0');
  assert.equal(audit.fieldPath, '/stem');
});

void test('a full printed label selects B-3 rather than neighboring A-3 in a legacy batch reply', async () => {
  const extractor = reExtractor(async () => reply({ questions: [
    { question_number: 'A-3', question_text: 'Different source.', options: [] },
    { question_number: 'B-3', question_text: 'Target source.', options: [] },
  ] }));
  const result = await extractor.reExtract({ png: Buffer.from('page'), questionNumber: 3, printedLabel: 'B-3', stemHint: 'Target', questionType: 'subjective' });
  assert.equal(result.stem, 'Target source.');
});

void test('numeric-only targeting cannot choose between two restarted source identities', async () => {
  const extractor = reExtractor(async () => reply({ questions: [
    { question_number: 'A-3', question_text: 'First source.', options: [] },
    { question_number: 'B-3', question_text: 'Second source.', options: [] },
  ] }));
  await assert.rejects(extractor.reExtract({ png: Buffer.from('page'), questionNumber: 3, stemHint: '', questionType: 'subjective' }), /could not read/);
});

void test('re-extraction preserves every printed matrix label and does not run a chemistry audit', async () => {
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

void test('re-extraction does not invent an A–D panel when a matrix page has no printed choices', async () => {
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

void test('a failed optional chemistry audit preserves an otherwise valid primary re-extraction', async () => {
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
  assert.equal(result.molecularAudits?.[0]?.status, 'unresolved');
  assert.match(result.chemistryIssues?.[0] ?? '', /did not complete/);
});

void test('a blank matrix-key retry cannot discard a usable first table read', async () => {
  let calls = 0;
  const extractor = reExtractor(async () => {
    calls += 1;
    if (calls === 1) {
      return reply({
        stem: 'Match the following microbes with their uses.',
        columns: matrixColumns,
        match: {},
        options: [
          { label: '1', body: '(a) (iii), (b) (iv)' },
          { label: '5', body: '(a) (i), (b) (ii)' },
          { label: 'F', body: 'None of these' },
        ],
      });
    }
    return reply({});
  });

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 123,
    stemHint: 'Match the following microbes',
    questionType: 'matrix',
  });

  assert.equal(calls, 2);
  assert.equal(result.stem, 'Match the following microbes with their uses.');
  assert.deepEqual(result.options.map((option) => option.label), ['1', '5', 'F']);
  assert.deepEqual(result.match?.key, {});
});

void test('re-extraction drops an unlabelled option instead of inventing an A–D label', async () => {
  const extractor = reExtractor(async () => reply({
    stem: 'Select the correct statement.',
    options: [{ label: 'this is not a printed label', body: 'Distractor text' }],
  }));

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 126,
    stemHint: 'Select the correct statement',
    questionType: 'single_correct',
  });

  assert.deepEqual(result.options, []);
  assert.equal(result.stem, 'Select the correct statement.');
});

void test('re-extraction isolates its target schema from batch extraction overrides', () => {
  const prompt = reExtractQuestionPrompt(
    { questionNumber: 127, stemHint: 'Read this question', questionType: 'single_correct' },
    { extraction: 'BATCH-ONLY-SENTINEL: return {"questions":[]}' },
  );

  assert.doesNotMatch(prompt, /BATCH-ONLY-SENTINEL/);
  assert.match(prompt, /"stem"/);
  assert.match(prompt, /"options"/);
});

void test('re-extraction reads the requested item from a legacy batch-shaped model reply', async () => {
  const extractor = reExtractor(async () => reply({
    questions: [
      { question_number: 122, question_text: 'Neighbouring question.', options: ['(A) wrong row'] },
      { question_number: 128, question_text: 'Target question.', options: ['(1) First', '(5) Fifth'] },
    ],
  }));

  const result = await extractor.reExtract({
    png: Buffer.from('page'),
    questionNumber: 128,
    stemHint: 'Target question',
    questionType: 'single_correct',
  });

  assert.equal(result.stem, 'Target question.');
  assert.deepEqual(result.options.map((option) => option.label), ['1', '5']);
});
