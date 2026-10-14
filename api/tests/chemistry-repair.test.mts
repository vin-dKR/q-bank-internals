import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentSchema, QuestionSchema, type Question, type UpdateQuestion } from '@ingest/contracts';
import { ChemistryRepairService } from '../src/modules/questions/chemistry-repair.service.js';

const STEM_URL = 'https://storage.example/question.png';
const OPTION_URL = 'https://storage.example/option.png';
const PATH = { module: 'Allen', chapter: 'Chemistry', section: 'Aromatic compounds' };

function question(overrides: Partial<Question> = {}): Question {
  return QuestionSchema.parse({
    id: 'q1', documentId: 'questions', questionNumber: 1, printedLabel: 'A-1', path: PATH,
    chemistry: {
      version: 1, status: 'needs_review', issues: [],
      candidateStem: 'Write the product: <smiles>c1ccccc1</smiles> with HBr and heat.',
      candidateOptions: ['(A) <smiles>c1ccccc1O</smiles>', '(B) Methane'],
      visuals: [
        { id: 'stem', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0.1, 0.1, 0.8, 0.2], candidateSmiles: ['c1ccccc1'], graphValid: true, cropUrl: STEM_URL },
        { id: 'option-a', field: 'option', optionLabel: 'A', kind: 'molecule', bbox: [0.1, 0.3, 0.4, 0.2], candidateSmiles: ['c1ccccc1O'], graphValid: true, cropUrl: OPTION_URL },
      ],
    },
    stem: '', options: [{ label: 'A', body: '', isCorrect: true }, { label: 'B', body: 'Methane', isCorrect: false }],
    answer: 'A', explanation: null, images: [], match: null,
    isQuestionImage: true, questionImage: STEM_URL, isOptionImage: true, optionImages: [OPTION_URL, ''],
    questionType: 'single_correct', sectionName: 'Aromatic compounds', topic: null, subject: 'Chemistry',
    flagged: false, isPyq: false, pyqExam: null, pyqYear: null, paper: null,
    sourceRegion: { page: 1, bbox: [0, 0, 1, 1] },
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
    ...overrides,
  });
}

function harness(input: { questions?: Question[]; beforeRefresh?: (rows: Map<string, Question>) => void } = {}): {
  service: ChemistryRepairService; rows: Map<string, Question>; writes: UpdateQuestion[];
} {
  const rows = new Map((input.questions ?? [question()]).map((row) => [row.id, row]));
  const document = DocumentSchema.parse({
    id: 'questions', kind: 'question', sessionId: 'session', driveFileId: 'questions', fileName: 'question.pdf', path: PATH,
    sectionName: 'Aromatic compounds', questionType: 'single_correct', subject: 'Chemistry', exam: 'JEE',
    pyq: false, pyqExam: null, pyqYear: null, paper: null, source: 'module', pageRange: null, topics: [],
    status: 'extracted', flagged: false, questionCount: rows.size,
    extractedAt: null, deletedAt: null, createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
  });
  const writes: UpdateQuestion[] = [];
  type Dependencies = ConstructorParameters<typeof ChemistryRepairService>;
  const service = new ChemistryRepairService(
    {
      findByDocument: async (id: string) => [...rows.values()].filter((row) => row.documentId === id),
      findById: async (id: string) => { input.beforeRefresh?.(rows); return rows.get(id) ?? null; },
      update: async (id: string, patch: UpdateQuestion) => {
        const current = rows.get(id);
        assert.ok(current);
        const updated = QuestionSchema.parse({ ...current, ...patch });
        rows.set(id, updated); writes.push(patch); return updated;
      },
    } as unknown as Dependencies[0], // Only persistence methods called by local conversion are needed.
    { findById: async (id: string) => id === document.id ? document : null } as unknown as Dependencies[1],
  );
  return { service, rows, writes };
}

void test('restores legacy blank fields as rendered SMILES and keeps original crops only in comparison evidence', async () => {
  const original = question();
  const { service } = harness({ questions: [original] });
  const result = await service.repair('questions', 'q1');
  const restored = result.updated[0];
  assert.ok(restored);
  assert.equal(restored.stem, original.chemistry?.candidateStem);
  assert.equal(restored.options[0]?.body, '<smiles>c1ccccc1O</smiles>');
  assert.equal(restored.answer, 'A');
  assert.equal(restored.questionImage, null);
  assert.equal(restored.isQuestionImage, false);
  assert.deepEqual(restored.optionImages, []);
  assert.equal(restored.isOptionImage, false);
  assert.deepEqual(restored.chemistry?.visuals, original.chemistry?.visuals);
  assert.equal(restored.chemistry?.representation, 'transcription');
  assert.equal(restored.chemistry.status, 'needs_review');
  assert.deepEqual(result.unresolved, []);
  assert.equal((await service.repair('questions')).unchanged, 1);
});

void test('restores exact old placeholder output across questions, answers and solutions without a source reread', async () => {
  const original = question({ stem: 'Write the product: [See source diagram] with HBr and heat.', answer: 'Product [See source diagram]', explanation: 'Heat gives [See source diagram]; then cool.', answerImages: ['https://storage.example/answer.png'], explanationImages: ['https://storage.example/solution.png'] });
  assert.ok(original.chemistry);
  original.chemistry.candidateAnswer = 'Product <smiles>c1ccccc1O</smiles>';
  original.chemistry.candidateExplanation = 'Heat gives <smiles>c1ccccc1O</smiles>; then cool.';
  original.chemistry.visuals.push(
    { id: 'answer', field: 'answer', optionLabel: null, kind: 'molecule', bbox: [0, 0, 0.4, 0.2], candidateSmiles: ['c1ccccc1O'], graphValid: true, cropUrl: original.answerImages[0] ?? '' },
    { id: 'solution', field: 'explanation', optionLabel: null, kind: 'molecule', bbox: [0, 0, 0.4, 0.2], candidateSmiles: ['c1ccccc1O'], graphValid: true, cropUrl: original.explanationImages[0] ?? '' },
  );
  const { service } = harness({ questions: [original] });
  const restored = (await service.repair('questions')).updated[0];
  assert.ok(restored);
  assert.equal(restored.stem, original.chemistry.candidateStem);
  assert.equal(restored.answer, original.chemistry.candidateAnswer);
  assert.equal(restored.explanation, original.chemistry.candidateExplanation);
  assert.deepEqual(restored.answerImages, []);
  assert.deepEqual(restored.explanationImages, []);
});

void test('preserves manual prose, corrected SMILES and image attachments while removing only owned automatic URLs', async () => {
  const manual = 'https://storage.example/manual.png';
  const original = question({ stem: 'My corrected product <smiles>CCO</smiles>', questionImage: `${STEM_URL},${manual}`, options: [{ label: 'A', body: 'Corrected <smiles>CO</smiles>', isCorrect: true }, { label: 'B', body: 'Methane', isCorrect: false }], optionImages: [OPTION_URL, manual], explanation: 'My solution <smiles>CN</smiles>', explanationImages: [manual], imageCrops: [{ url: STEM_URL, type: 'question', optionIndex: 0, nx: 0, ny: 0, nw: 10, nh: 10 }, { url: manual, type: 'solution', optionIndex: 0, nx: 10, ny: 10, nw: 10, nh: 10 }] });
  const { service } = harness({ questions: [original] });
  const restored = (await service.repair('questions')).updated[0];
  assert.ok(restored);
  assert.equal(restored.stem, original.stem);
  assert.equal(restored.questionImage, manual);
  assert.equal(restored.isQuestionImage, true);
  assert.deepEqual(restored.options, original.options);
  assert.deepEqual(restored.optionImages, ['', manual]);
  assert.equal(restored.explanation, original.explanation);
  assert.deepEqual(restored.explanationImages, [manual]);
  assert.deepEqual(restored.imageCrops.map((crop) => crop.url), [manual]);
});

void test('keeps valid existing molecular answer and solution text when the ledger has no saved candidate', async () => {
  const original = question({ answer: '<smiles>CO</smiles>', explanation: 'Then <smiles>CN</smiles>' });
  const { service } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.updated[0]?.answer, original.answer);
  assert.equal(result.updated[0].explanation, original.explanation);
  assert.deepEqual(result.unresolved, []);
});

void test('reports missing recognized structures without creating a crop fallback', async () => {
  const original = question({ stem: 'Give the product [See source diagram]' });
  assert.ok(original.chemistry);
  original.chemistry.candidateStem = '';
  const { service } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.updated[0]?.stem, 'Give the product');
  assert.equal(result.updated[0].questionImage, null);
  assert.equal(result.unresolved[0]?.field, 'stem');
  assert.match(result.unresolved[0].message, /no saved molecular transcription/);
});

void test('does not restore a labelled choice candidate into another source option', async () => {
  const original = question();
  assert.ok(original.chemistry);
  original.chemistry.candidateOptions[0] = '(D) <smiles>CO</smiles>';
  const { service } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.updated[0]?.options[0]?.body, '');
  assert.match(result.unresolved[0]?.message ?? '', /different printed choice/);
});

void test('does not modify a transcription record or remove manually selected last-resort figures', async () => {
  const original = question();
  assert.ok(original.chemistry);
  original.chemistry.representation = 'transcription';
  original.stem = '<smiles>CCO</smiles>';
  const { service, rows, writes } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.unchanged, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(rows.get('q1'), original);
});

void test('preserves concurrent user edits instead of applying a stale candidate conversion', async () => {
  const original = question();
  const { service, rows, writes } = harness({ questions: [original], beforeRefresh: (current) => current.set('q1', { ...original, stem: 'Concurrent user edit' }) });
  const result = await service.repair('questions');
  assert.equal(result.updated.length, 0);
  assert.match(result.unresolved[0]?.message ?? '', /changed during recovery/);
  assert.equal(rows.get('q1')?.stem, 'Concurrent user edit');
  assert.deepEqual(writes, []);
});
