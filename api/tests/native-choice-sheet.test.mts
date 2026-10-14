import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeChoiceSheet } from '../src/modules/extraction/native-choice-key.js';

void test('local key sheets include exactly the requested scoped full identities', () => {
  const sheet = nativeChoiceSheet({ 'A-3': 'D', 'B-3': 'B', 'B-4': 'C', 'C-9': 'A' }, ['B—003.', 'B-4'], 'Ex1 · part2');
  assert.deepEqual(sheet, {
    sectionName: 'Ex1 · part2',
    entries: {
      'B-3': { answer: 'B', explanation: null, answerSource: 'answer_key' },
      'B-4': { answer: 'C', explanation: null, answerSource: 'answer_key' },
    },
  });
});

void test('same numeric ordinal across prefixes retains independent keys', () => {
  const sheet = nativeChoiceSheet({ 'A-3': 'D', 'B-3': 'B' }, ['A-3', 'B-3'], 'Exercise');
  assert.ok(sheet);
  assert.equal(sheet.entries['A-3']?.answer, 'D');
  assert.equal(sheet.entries['B-3']?.answer, 'B');
  assert.equal(nativeChoiceSheet({ 'A-3': 'D', '3': 'B' }, ['B-3'], 'Exercise'), null);
});

void test('incomplete coverage never becomes a partial authoritative local sheet', () => {
  assert.equal(nativeChoiceSheet({ 'B-3': 'B' }, ['B-3', 'B-4'], 'Exercise'), null);
  assert.equal(nativeChoiceSheet({ 'B-3': 'B' }, undefined, 'Exercise'), null);
  assert.equal(nativeChoiceSheet({ 'B-3': 'B' }, [], 'Exercise'), null);
  assert.equal(nativeChoiceSheet(null, ['B-3'], 'Exercise'), null);
});

void test('unrecognized requested identities cannot be silently dropped from completeness checks', () => {
  for (const unreadable of ['', '   ', 'unreadable']) {
    assert.equal(nativeChoiceSheet({ 'B-3': 'B' }, ['B-3', unreadable], 'Exercise'), null);
  }
});

void test('normalization collisions in requested identities are ambiguous', () => {
  assert.equal(nativeChoiceSheet({ 'B-3': 'B' }, ['B-3', 'B—003.'], 'Exercise'), null);
});

void test('every local value must be one nonempty supported printed choice', () => {
  for (const invalid of ['', ' ', 'AB', '(B)', 'E', '2', 'B because it reacts']) {
    assert.equal(nativeChoiceSheet({ 'B-3': 'B', 'B-4': invalid }, ['B-3', 'B-4'], 'Exercise'), null);
  }
  assert.equal(nativeChoiceSheet({ 'B-3': ' b ' }, ['B-3'], 'Exercise')?.entries['B-3']?.answer, 'B');
});
