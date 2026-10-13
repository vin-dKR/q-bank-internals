import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentSchema, type Document } from '@ingest/contracts';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import type { AnswerExtractionScope, PageImage } from '../src/modules/extraction/index.js';

const document: Document = DocumentSchema.parse({
  id: 'answer-doc', sessionId: 'session', driveFileId: 'answer-drive', fileName: 'answers.pdf', uploadGroupId: 'upload',
  path: { module: 'Resonance', chapter: 'Nitrogen compounds', section: 'All sections' },
  kind: 'answer', sectionName: 'All sections', questionType: 'single_correct', answerLayout: 'separate',
  exam: 'NEET', className: null, subject: 'Chemistry', pyq: false, pyqExam: null, pyqYear: null, paper: null,
  source: 'module', pageRange: null, topics: [], status: 'uploaded', flagged: false, deletedAt: null,
  questionCount: 0, extractedAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});
const scope: AnswerExtractionScope = {
  sectionName: 'Ex1 · part2', questionType: 'single_correct', expectedPrintedLabels: ['B-3', 'B-4'],
  questionPageRange: { from: 6, to: 12 }, sourcePageRange: { from: 5, to: 5 },
};
const page: PageImage = { pageNumber: 5, png: Buffer.from('local-test-image'), nativeChoiceKeys: { 'A-3': 'D', 'B-3': 'B', 'B-4': 'C' } };

function extractor(): { instance: OpenAiVisionExtractor; sdkCalls: () => number } {
  let calls = 0;
  const instance = new OpenAiVisionExtractor('test-key', 'test-model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(instance, { client: { chat: { completions: { create: async () => {
    calls += 1;
    return {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sections: [{ answers: { 'B-3': 'A', 'B-4': 'D' } }] }) } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    };
  } } } } });
  return { instance, sdkCalls: () => calls };
}

void test('eligible native single-correct keys return scoped answers without any SDK call or token spend', async () => {
  const { instance, sdkCalls } = extractor();
  const result = await instance.extractAnswers({ pages: [page], document, scope });
  assert.equal(sdkCalls(), 0);
  assert.deepEqual(result.usage, { model: 'test-model', promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 });
  assert.deepEqual(result.sheets, [{ sectionName: scope.sectionName, entries: {
    'B-3': { answer: 'B', explanation: null, answerSource: 'answer_key' },
    'B-4': { answer: 'C', explanation: null, answerSource: 'answer_key' },
  } }]);
});

void test('incomplete or wrong-prefix native evidence falls back to the ordinary answer extraction', async () => {
  for (const nativeChoiceKeys of [{ 'B-3': 'B' }, { 'A-3': 'B', 'A-4': 'C' }, { '3': 'B', '4': 'C' }]) {
    const { instance, sdkCalls } = extractor();
    const result = await instance.extractAnswers({ pages: [{ ...page, nativeChoiceKeys }], document, scope });
    assert.equal(sdkCalls(), 1);
    assert.equal(result.usage.callCount, 1);
    assert.equal(result.usage.totalTokens, 18);
    const sheet = result.sheets[0];
    assert.ok(sheet);
    assert.equal(sheet.sectionName, scope.sectionName);
    assert.equal(sheet.entries['B-3']?.answer, 'A');
  }
});

void test('unscoped document-level single-correct metadata cannot authorize a native key match', async () => {
  const { instance, sdkCalls } = extractor();
  const result = await instance.extractAnswers({ pages: [page], document });
  assert.equal(sdkCalls(), 1);
  assert.equal(result.sheets[0]?.sectionName, document.sectionName);
});

void test('a scope without expected identities cannot claim complete native coverage', async () => {
  const { expectedPrintedLabels: _expected, ...unbound } = scope;
  assert.equal(_expected?.length, 2);
  const { instance, sdkCalls } = extractor();
  const result = await instance.extractAnswers({ pages: [page], document, scope: unbound });
  assert.equal(sdkCalls(), 1);
  assert.equal(result.sheets[0]?.entries['B-4']?.answer, 'D');
});

void test('unsupported or invalid local choices use the ordinary extraction path', async () => {
  for (const altered of [
    { ...scope, questionType: 'multi_correct' },
    { ...scope, expectedPrintedLabels: ['B-3', 'unreadable'] },
    { ...scope, expectedPrintedLabels: ['B-3', 'B—003.'] },
  ]) {
    const { instance, sdkCalls } = extractor();
    await instance.extractAnswers({ pages: [page], document, scope: altered });
    assert.equal(sdkCalls(), 1);
  }
  const { instance, sdkCalls } = extractor();
  await instance.extractAnswers({ pages: [{ ...page, nativeChoiceKeys: { 'B-3': 'B', 'B-4': 'AB' } }], document, scope });
  assert.equal(sdkCalls(), 1);
});
