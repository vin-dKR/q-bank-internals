import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChemistryExtractionSchema, QuestionSchema, type ChemistryExtraction } from '@ingest/contracts';
import { InMemoryQuestionRepository } from '../src/infrastructure/database/repositories/question.in-memory-repository.js';
import type { NewQuestion } from '../src/modules/questions/questions.repository.js';

const chemistry: ChemistryExtraction = {
  version: 1,
  status: 'source_preserved',
  issues: ['Candidate structure requires source comparison.'],
  candidateStem: '<smiles>c1ccccc1</smiles>',
  candidateOptions: ['(A) <smiles>C1CCCC1</smiles>'],
  visuals: [{
    id: 'q-b-3-option-a',
    field: 'option',
    optionLabel: 'A',
    kind: 'molecule',
    bbox: [0.2, 0.3, 0.2, 0.1],
    candidateSmiles: ['C1CCCC1'],
    graphValid: true,
    cropUrl: 'https://example.test/source-option-a.png',
  }],
};

function draft(overrides: Partial<NewQuestion> = {}): NewQuestion {
  return {
    documentId: 'document', questionNumber: 3,
    path: { module: 'Chemistry', chapter: 'Nitrogen compounds', section: 'Exercise B' },
    stem: '', options: [{ label: 'A', body: '', isCorrect: false }], answer: '',
    match: null, passageId: null, groupOrder: null, explanation: null, images: [],
    questionType: 'single_correct', level: null, aiFilled: null, sectionName: 'Exercise B',
    topic: null, className: null, subject: 'Chemistry', isPyq: false, pyqExam: null,
    pyqYear: null, paper: null, sourceRegion: { page: 9, bbox: [0.1, 0.3, 0.8, 0.5] },
    ...overrides,
  };
}

void test('source crop display and audit-only candidates survive question persistence together', async () => {
  const repository = new InMemoryQuestionRepository();
  await repository.replaceDocument('document', [], [draft({
    printedLabel: 'B-3', chemistry, isQuestionImage: true,
    questionImage: 'https://example.test/source-stem.png', isOptionImage: true,
    optionImages: ['https://example.test/source-option-a.png'],
    imageCrops: [{ url: 'https://example.test/source-option-a.png', type: 'option', optionIndex: 0, nx: 200, ny: 300, nw: 200, nh: 100 }],
  })]);
  const [saved] = await repository.findByDocument('document');
  assert.ok(saved);
  assert.equal(saved.printedLabel, 'B-3');
  assert.equal(saved.chemistry?.status, 'source_preserved');
  assert.equal(saved.stem, '');
  assert.equal(saved.options[0]?.body, '');
  assert.equal(saved.isQuestionImage, true);
  assert.equal(saved.isOptionImage, true);
  assert.equal(saved.questionImage, 'https://example.test/source-stem.png');
  assert.equal(saved.optionImages[0], chemistry.visuals[0]?.cropUrl);
  assert.equal(saved.imageCrops[0]?.optionIndex, 0);
  assert.deepEqual(saved.sourceRegion.bbox, [0.1, 0.3, 0.8, 0.5]);
  assert.deepEqual(saved.chemistry, chemistry);
});

void test('legacy draft and API records remain readable with absent identity and chemistry fields', async () => {
  const repository = new InMemoryQuestionRepository();
  await repository.replaceDocument('document', [], [draft()]);
  const [saved] = await repository.findByDocument('document');
  assert.ok(saved);
  const legacy = Object.fromEntries(Object.entries(saved).filter(([field]) => field !== 'chemistry' && field !== 'printedLabel'));
  const parsed = QuestionSchema.parse(legacy);
  assert.equal(parsed.printedLabel, null);
  assert.equal(parsed.chemistry, null);
  assert.equal(parsed.isQuestionImage, false);
  assert.deepEqual(parsed.imageCrops, []);
});

void test('chemistry source rectangles cannot extend beyond their source page', () => {
  const visual = chemistry.visuals[0];
  assert.ok(visual);
  const parsed = ChemistryExtractionSchema.safeParse({
    ...chemistry,
    visuals: [{ ...visual, bbox: [0.9, 0.3, 0.2, 0.1] }],
  });
  assert.equal(parsed.success, false);
});
