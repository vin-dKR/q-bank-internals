import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Question } from '@ingest/contracts';
import { matrixProjectionForPublish } from '../src/modules/publish/publish.service.js';

const match = {
  columns: [
    { title: 'Column I', entries: [{ label: 'a', body: 'Alpha' }, { label: 'b', body: 'Beta' }] },
    { title: 'Column II', entries: [{ label: 'i', body: 'One' }, { label: 'ii', body: 'Two' }] },
  ],
  key: { a: ['i'], b: ['ii'] },
};

function matrix(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    questionType: 'matrix',
    answer: '',
    options: [],
    match,
    ...overrides,
  } as Question;
}

void test('publish keeps a table-only matrix table-only instead of generating A–D choices', () => {
  const projection = matrixProjectionForPublish(matrix({}));

  assert.deepEqual(projection?.options, []);
  assert.equal(projection.answer, 'a-i; b-ii');
});

void test('publish preserves arbitrary source option labels and their selected source label', () => {
  const options = [
    { label: '1', body: '(a) (i), (b) (ii)', isCorrect: false },
    { label: '5', body: '(a) (ii), (b) (i)', isCorrect: true },
    { label: 'F', body: '(a) (i), (b) (i)', isCorrect: false },
  ];
  const projection = matrixProjectionForPublish(matrix({ options, answer: '5' }));

  assert.deepEqual(projection?.options, options);
  assert.equal(projection.answer, '5');
});
