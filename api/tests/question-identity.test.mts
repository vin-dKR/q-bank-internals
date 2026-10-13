import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChapterTopic } from '@ingest/contracts';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import { normalizePrintedQuestionLabel, questionNumberFromPrintedLabel } from '../src/modules/extraction/question-identity.js';
import { mergeAnswerEntries, type AnswerEntry, type AnswerSheet, type ExtractedQuestion } from '../src/modules/extraction/vision-extractor.js';

function question(overrides: Partial<ExtractedQuestion> = {}): ExtractedQuestion {
  return {
    questionNumber: 3,
    questionText: 'Select the major product.',
    options: ['(A) One', '(B) Two', '(C) Three', '(D) Four'],
    answer: null,
    explanation: null,
    sectionName: 'All sections',
    questionType: 'single_correct',
    level: null,
    difficultyConfidence: null,
    sourcePage: 1,
    pyqExam: null,
    pyqYear: null,
    match: null,
    passage: null,
    passageId: null,
    groupOrder: null,
    ...overrides,
  };
}

function sheet(entries: Record<string, AnswerEntry>, sectionName = 'All sections'): AnswerSheet {
  return { sectionName, entries };
}

function key(answer: string): AnswerEntry {
  return { answer, explanation: null, answerSource: 'answer_key' };
}

void test('printed identity normalizes typography while preserving exercise prefixes and subparts', () => {
  assert.equal(normalizePrintedQuestionLabel(' (b — 003.) '), 'B-3');
  assert.equal(normalizePrintedQuestionLabel('Q. 003'), '3');
  assert.equal(normalizePrintedQuestionLabel('Question 003'), '3');
  assert.equal(normalizePrintedQuestionLabel('3(a)'), '3(A)');
  assert.equal(questionNumberFromPrintedLabel('B-003'), 3);
  assert.equal(questionNumberFromPrintedLabel('3(a)'), 3);
  assert.equal(normalizePrintedQuestionLabel('unreadable'), null);
});

void test('full printed labels keep A-3 and B-3 separate within the same topic', () => {
  const result = mergeAnswers([
    question({ printedLabel: 'A-3' }), question({ printedLabel: 'B-3' }),
  ], [sheet({ 'A-3': key('A'), 'B—3.': key('D') })], []);
  assert.deepEqual(result.map((row) => row.answer), ['A', 'D']);
});

void test('a bare numeric key cannot assign a prefix collision', () => {
  const result = mergeAnswers([
    question({ printedLabel: 'A-3' }), question({ printedLabel: 'B-3' }),
  ], [sheet({ '3': key('C') })], []);
  assert.deepEqual(result.map((row) => row.answer), [null, null]);
});

void test('known contradictory prefixes cannot match through their numeric part', () => {
  const [result] = mergeAnswers([question({ printedLabel: 'B-3' })], [sheet({ 'C-3': key('A') })], []);
  assert.equal(result?.answer, null);
});

void test('unique legacy numbers and unique bare keys retain compatibility', () => {
  const [legacy] = mergeAnswers([question()], [sheet({ '003': key('D') })], []);
  const [prefixed] = mergeAnswers([question({ printedLabel: 'B-3' })], [sheet({ '3': key('C') })], []);
  assert.equal(legacy?.answer, 'D');
  assert.equal(prefixed?.answer, 'C');
});

void test('a legacy question number cannot choose between two full source labels', () => {
  const [result] = mergeAnswers([question()], [sheet({ 'A-3': key('A'), 'B-3': key('C') })], []);
  assert.equal(result?.answer, null);
});

void test('restarted question numbers use only their bound topic keys', () => {
  const topics: ChapterTopic[] = [
    { name: 'Topic A', types: [{ questionType: 'single_correct', pageRange: { from: 1, to: 1 } }] },
    { name: 'Topic B', types: [{ questionType: 'single_correct', pageRange: { from: 2, to: 2 } }] },
  ];
  const questions = [question(), question({ sourcePage: 2 })];
  const ambiguous = mergeAnswers(questions, [sheet({ '3': key('D') })], topics);
  const scoped = mergeAnswers(questions, [sheet({ '3': key('B') }, 'Topic A'), sheet({ '3': key('C') }, 'Topic B')], topics);
  assert.deepEqual(ambiguous.map((row) => row.answer), [null, null]);
  assert.deepEqual(scoped.map((row) => row.answer), ['B', 'C']);
});

void test('duplicate question identities within a scope never receive one guessed key', () => {
  const result = mergeAnswers([
    question({ printedLabel: 'B-3' }), question({ printedLabel: 'B-3', sourcePage: 2 }),
  ], [sheet({ 'B-3': key('A') })], []);
  assert.deepEqual(result.map((row) => row.answer), [null, null]);
});

void test('equal-priority duplicate answer conflicts remain unresolved after a third vote', () => {
  const [result] = mergeAnswers([question({ printedLabel: 'B-3', answer: 'D' })], [
    sheet({ 'B-3': key('A') }), sheet({ 'B—3': key('B') }), sheet({ 'B-3': key('A') }),
  ], []);
  assert.equal(result?.answer, null);
});

void test('an explicit answer key resolves solution disagreement and preserves worked text', () => {
  const conflicted = mergeAnswerEntries(
    { answer: 'A', explanation: 'First derivation.', answerSource: 'solution' },
    { answer: 'B', explanation: 'Second derivation.', answerSource: 'solution' },
  );
  assert.equal(conflicted.answer, null);
  assert.equal(conflicted.answerConflict, true);
  const resolved = mergeAnswerEntries(conflicted, key('C'));
  assert.equal(resolved.answer, 'C');
  assert.equal(resolved.answerConflict, undefined);
  assert.equal(resolved.explanation, 'First derivation.\n\nSecond derivation.');
});

void test('an exact printed identity works even when no numeric draft number was extracted', () => {
  const [result] = mergeAnswers([question({ questionNumber: null, printedLabel: 'B-3' })], [sheet({ 'B-3': key('B') })], []);
  assert.equal(result?.answer, 'B');
});

void test('an empty higher-priority key cannot erase an unresolved solution conflict', () => {
  const conflicted = mergeAnswerEntries(
    { answer: 'A', explanation: null, answerSource: 'solution' },
    { answer: 'B', explanation: null, answerSource: 'solution' },
  );
  const stillConflicted = mergeAnswerEntries(conflicted, { answer: null, explanation: null, answerSource: 'answer_key' });
  const laterSolution = mergeAnswerEntries(stillConflicted, { answer: 'A', explanation: null, answerSource: 'solution' });
  assert.equal(laterSolution.answer, null);
  assert.equal(laterSolution.answerConflict, true);
});

void test('topicless repeated numbers match their explicit printed source sections', () => {
  const result = mergeAnswers([
    question({ printedLabel: '3', sectionName: 'Exercise 1' }),
    question({ printedLabel: '3', sectionName: 'Exercise 2', sourcePage: 2 }),
  ], [sheet({ '3': key('A') }, 'Exercise 1'), sheet({ '3': key('B') }, 'Exercise 2')], []);
  assert.deepEqual(result.map((row) => row.answer), ['A', 'B']);
});

void test('globally unique prefixed labels may match a flat key across restarted source sections', () => {
  const result = mergeAnswers([
    question({ printedLabel: 'A-3', sectionName: 'Exercise A' }),
    question({ printedLabel: 'B-3', sectionName: 'Exercise B', sourcePage: 2 }),
  ], [sheet({ 'A-3': key('A'), 'B-3': key('B') })], []);
  assert.deepEqual(result.map((row) => row.answer), ['A', 'B']);
  const bare = mergeAnswers([
    question({ printedLabel: 'A-3', sectionName: 'Exercise A' }),
    question({ printedLabel: 'B-3', sectionName: 'Exercise B', sourcePage: 2 }),
  ], [sheet({ '3': key('D') })], []);
  assert.deepEqual(bare.map((row) => row.answer), [null, null]);
});
