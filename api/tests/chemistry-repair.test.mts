import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentSchema, QuestionSchema, chemistrySourceReviewIssues, type Document, type Question, type UpdateQuestion } from '@ingest/contracts';
import { ChemistryRepairService } from '../src/modules/questions/chemistry-repair.service.js';
import type { PageImage } from '../src/modules/extraction/index.js';

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

function document(id = 'questions', kind: Document['kind'] = 'question'): Document {
  return DocumentSchema.parse({
    id, kind, sessionId: 'session', driveFileId: id, fileName: `${id}.pdf`, uploadGroupId: 'group', path: PATH,
    sectionName: 'Aromatic compounds', questionType: 'single_correct', subject: 'Chemistry', exam: 'JEE',
    pyq: false, pyqExam: null, pyqYear: null, paper: null, source: 'module', answerLayout: 'separate',
    pageRange: null,
    topics: kind === 'question' ? [{ name: 'Phenols', types: [{ questionType: 'single_correct', pageRange: { from: 1, to: 2 }, answerPageRange: { from: 4, to: 5 }, solutionPageRange: { from: 6, to: 7 } }] }] : [],
    status: 'extracted', flagged: false, questionCount: kind === 'question' ? 1 : 0,
    extractedAt: null, deletedAt: null, createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
  });
}

function page(pageNumber: number, label = 'A-1', limitations: string[] = []): PageImage {
  return {
    pageNumber, png: Buffer.from(`source-${String(pageNumber)}`),
    layout: {
      source: 'native_pdf', width: 1000, height: 1500, contentBox: [0, 0, 1, 1], limitations,
      questions: [
        { printedLabel: label, sourceSection: null, anchorBox: [0.1, 0.1, 0.15, 0.13], bbox: [0.1, 0.1, 0.9, 0.7], stemBbox: null, options: [] },
        { printedLabel: 'A-2', sourceSection: null, anchorBox: [0.1, 0.73, 0.15, 0.76], bbox: [0.1, 0.7, 0.9, 0.95], stemBbox: null, options: [] },
      ],
    },
  };
}

function harness(input: {
  questions?: Question[];
  documents?: Document[];
  pages?: Map<string, PageImage>;
  beforeUpload?: (rows: Map<string, Question>) => void;
} = {}): {
  service: ChemistryRepairService;
  rows: Map<string, Question>;
  uploads: string[];
  reads: string[];
  writes: UpdateQuestion[];
} {
  const rows = new Map((input.questions ?? [question()]).map((row) => [row.id, row]));
  const docs = input.documents ?? [document(), document('answers', 'answer'), document('solutions', 'solution')];
  const uploads: string[] = [];
  const reads: string[] = [];
  const writes: UpdateQuestion[] = [];
  type Dependencies = ConstructorParameters<typeof ChemistryRepairService>;
  const service = new ChemistryRepairService(
    {
      findByDocument: async (id: string) => [...rows.values()].filter((row) => row.documentId === id),
      findById: async (id: string) => rows.get(id) ?? null,
      update: async (id: string, patch: UpdateQuestion) => {
        const current = rows.get(id);
        assert.ok(current);
        const updated = QuestionSchema.parse({ ...current, ...patch });
        rows.set(id, updated);
        writes.push(patch);
        return updated;
      },
    } as unknown as Dependencies[0], // Test double implements only persistence operations exercised here.
    {
      findById: async (id: string) => docs.find((doc) => doc.id === id) ?? null,
      listBySession: async () => docs,
    } as unknown as Dependencies[1], // No source, status, or deletion writes are part of recovery.
    { upload: async (name: string) => { input.beforeUpload?.(rows); uploads.push(name); return `https://storage.example/${name}`; } },
    {
      renderPage: async () => { throw new Error('Native evidence reader must be used.'); },
      readSourcePage: async (id: string, number: number) => {
        const key = `${id}:${String(number)}`;
        reads.push(key);
        return input.pages?.get(key) ?? { pageNumber: number, png: Buffer.from('empty'), layout: null };
      },
    },
    { dimensions: async () => ({ width: 1000, height: 1500 }), crop: async (_png, box) => Buffer.from(JSON.stringify(box)), compose: async () => { throw new Error('Single native region expected.'); } },
  );
  return { service, rows, uploads, reads, writes };
}

void test('restores readable stem and labelled option prose without changing source crop ownership', async () => {
  const { service, uploads } = harness();
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated.length, 1);
  const restored = result.updated[0];
  assert.ok(restored);
  assert.equal(restored.stem, 'Write the product: [See source diagram] with HBr and heat.');
  assert.equal(restored.options[0]?.body, '[See source diagram]');
  assert.equal(restored.questionImage, STEM_URL);
  assert.deepEqual(restored.optionImages, [OPTION_URL, '']);
  assert.deepEqual(chemistrySourceReviewIssues(restored), []);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(uploads, []);
  assert.equal((await service.repair('questions')).unchanged, 1);
});

void test('repairs both answer and solution from separate bound native sources and retains all provenance', async () => {
  const original = question({ answer: 'Product <smiles>c1ccccc1O</smiles>', explanation: 'Heat gives <smiles>c1ccccc1O</smiles>; then cool.' });
  const { service, uploads, reads } = harness({
    questions: [original], pages: new Map([['answers:4', page(4)], ['solutions:6', page(6)]]),
  });
  const result = await service.repair('questions');
  const restored = result.updated[0];
  assert.ok(restored);
  assert.equal(restored.answer, 'Product [See source diagram]');
  assert.equal(restored.explanation, 'Heat gives [See source diagram]; then cool.');
  assert.equal(restored.chemistry?.candidateAnswer, original.answer);
  assert.equal(restored.chemistry.candidateExplanation, original.explanation);
  assert.equal(restored.answerImages.length, 1);
  assert.equal(restored.explanationImages.length, 1);
  assert.deepEqual(restored.imageCrops.map((crop) => [crop.type, crop.sourceDocumentId, crop.sourcePage, crop.nx, crop.ny, crop.nw, crop.nh]), [
    ['answer', 'answers', 4, 100, 150, 800, 900],
    ['solution', 'solutions', 6, 100, 150, 800, 900],
  ]);
  assert.equal(uploads.length, 2);
  assert.deepEqual(reads, ['answers:4', 'answers:5', 'solutions:6', 'solutions:7']);
  assert.deepEqual(chemistrySourceReviewIssues(restored), []);
  assert.deepEqual(result.unresolved, []);
  const repeated = await service.repair('questions');
  assert.equal(repeated.unchanged, 1);
  assert.equal(uploads.length, 2);
});

void test('keeps manual prose and image modifications instead of restoring old extraction candidates', async () => {
  const original = question({ stem: 'My edited question', questionImage: 'https://storage.example/manual.png', options: [{ label: 'A', body: 'Edited answer choice', isCorrect: true }, { label: 'B', body: 'Methane', isCorrect: false }], explanation: '<smiles>CO</smiles>', explanationImages: ['https://storage.example/manual-solution.png'] });
  const { service, rows, uploads } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.updated.length, 0);
  assert.equal(result.unresolved[0]?.field, 'explanation');
  assert.deepEqual(rows.get('q1'), original);
  assert.deepEqual(uploads, []);
});

void test('repairs readable question text but keeps an unresolved solution candidate on a scanned source', async () => {
  const original = question({ explanation: 'Product <smiles>CO</smiles>' });
  const { service, uploads } = harness({ questions: [original] });
  const result = await service.repair('questions');
  assert.equal(result.updated[0]?.explanation, original.explanation);
  assert.equal(result.updated[0].stem, 'Write the product: [See source diagram] with HBr and heat.');
  assert.equal(result.unresolved[0]?.field, 'explanation');
  assert.match(result.unresolved[0].message, /one complete source region/);
  assert.deepEqual(uploads, []);
});

void test('rejects repeated printed identities within the same bound topic without sending any source reads', async () => {
  const original = question({ explanation: '<smiles>CO</smiles>' });
  const { service, reads, uploads } = harness({ questions: [original, question({ id: 'q2', sourceRegion: { page: 2, bbox: [0, 0, 1, 1] } })] });
  const result = await service.repair('questions', 'q1');
  assert.match(result.unresolved[0]?.message ?? '', /occurs more than once/);
  assert.deepEqual(reads, []);
  assert.deepEqual(uploads, []);
});

void test('does not drop a printed prefix or guess ownership for a continued native solution', async () => {
  for (const sourcePage of [page(6, '1'), page(6, 'A-1', ['column_continuation'])]) {
    const original = question({ explanation: '<smiles>CO</smiles>' });
    const { service, uploads } = harness({ questions: [original], pages: new Map([['solutions:6', sourcePage]]) });
    const result = await service.repair('questions', 'q1');
    assert.equal(result.updated[0]?.explanation, original.explanation);
    assert.equal(result.unresolved[0]?.field, 'explanation');
    assert.deepEqual(uploads, []);
  }
});

void test('keeps concurrent edits even when source crop preservation has completed', async () => {
  const original = question({ explanation: '<smiles>CO</smiles>' });
  const { service, rows, writes } = harness({
    questions: [original], pages: new Map([['solutions:6', page(6)]]),
    beforeUpload: (current) => current.set('q1', { ...original, stem: 'Concurrent user edit' }),
  });
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated.length, 0);
  assert.match(result.unresolved[0]?.message ?? '', /changed during recovery/);
  assert.equal(rows.get('q1')?.stem, 'Concurrent user edit');
  assert.deepEqual(writes, []);
});

void test('multiple existing solution source crops can replace only their unverified molecule renderings', async () => {
  const original = question({ explanation: 'Step <smiles>CO</smiles> then <smiles>CN</smiles>.', explanationImages: ['https://storage.example/first.png', 'https://storage.example/second.png'] });
  assert.ok(original.chemistry);
  original.chemistry.visuals.push(...original.explanationImages.map((url, index) => ({ id: `solution-${String(index)}`, field: 'explanation' as const, optionLabel: null, kind: 'figure' as const, bbox: [0.1, 0.1, 0.8, 0.2] as [number, number, number, number], candidateSmiles: [], graphValid: null, cropUrl: url })));
  const { service, uploads } = harness({ questions: [original] });
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated[0]?.explanation, 'Step [See source diagram] then [See source diagram].');
  assert.deepEqual(result.updated[0].explanationImages, original.explanationImages);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(uploads, []);
});

void test('restores unrecognized source diagrams without a molecular tag and clears only the resolved field', async () => {
  const original = question({ explanation: 'The product is shown in the source diagram.' });
  assert.ok(original.chemistry);
  original.chemistry.unresolvedSourceFields = ['answer', 'explanation'];
  const { service } = harness({ questions: [original], pages: new Map([['solutions:6', page(6)]]) });
  const result = await service.repair('questions', 'q1');
  const restored = result.updated[0];
  assert.ok(restored);
  assert.equal(restored.explanation, original.explanation);
  assert.equal(restored.explanationImages.length, 1);
  assert.deepEqual(restored.chemistry?.unresolvedSourceFields, ['answer']);
  assert.equal(result.unresolved[0]?.field, 'answer');
});

void test('a known solution fragment cannot clear a missing continuation source stamp', async () => {
  const original = question({ explanation: 'The reaction continues on another page.', explanationImages: ['https://storage.example/fragment.png'] });
  assert.ok(original.chemistry);
  original.chemistry.unresolvedSourceFields = ['explanation'];
  original.chemistry.visuals.push({ id: 'fragment', field: 'explanation', optionLabel: null, kind: 'figure', bbox: [0.1, 0.1, 0.8, 0.2], candidateSmiles: [], graphValid: null, cropUrl: original.explanationImages[0] ?? '' });
  const { service, uploads } = harness({ questions: [original], pages: new Map([['solutions:6', page(6)]]) });
  const result = await service.repair('questions', 'q1');
  assert.deepEqual(result.updated[0]?.chemistry?.unresolvedSourceFields, ['explanation']);
  assert.deepEqual(result.updated[0].explanationImages, original.explanationImages);
  assert.equal(result.unresolved[0]?.field, 'explanation');
  assert.match(result.unresolved[0].message, /missing or continued diagram/);
  assert.deepEqual(uploads, []);
});

void test('a changed molecular solution is not replaced using an older extraction ledger', async () => {
  const original = question({ explanation: 'My edited product <smiles>CN</smiles>' });
  assert.ok(original.chemistry);
  original.chemistry.candidateExplanation = 'Original product <smiles>CO</smiles>';
  const { service, uploads } = harness({ questions: [original], pages: new Map([['solutions:6', page(6)]]) });
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated[0]?.explanation, original.explanation);
  assert.match(result.unresolved[0]?.message ?? '', /text differs from its saved extraction/);
  assert.deepEqual(uploads, []);
});

void test('a native bottom-of-page question cannot be treated as complete without its continuation boundary', async () => {
  const source = page(6);
  assert.ok(source.layout);
  source.layout.questions = source.layout.questions.slice(0, 1);
  const original = question({ explanation: '<smiles>CO</smiles>' });
  const { service, uploads } = harness({ questions: [original], pages: new Map([['solutions:6', source], ['solutions:7', page(7, 'A-3')]]) });
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated[0]?.explanation, original.explanation);
  assert.match(result.unresolved[0]?.message ?? '', /may continue on another page/);
  assert.deepEqual(uploads, []);
});

void test('one explicitly bound source page preserves its complete visible final block for review', async () => {
  const source = page(6);
  assert.ok(source.layout);
  source.layout.questions = source.layout.questions.slice(0, 1);
  const owner = document();
  const block = owner.topics[0]?.types[0];
  assert.ok(block);
  block.solutionPageRange = { from: 6, to: 6 };
  const original = question({ explanation: '<smiles>CO</smiles>' });
  const { service, uploads } = harness({ questions: [original], documents: [owner, document('solutions', 'solution')], pages: new Map([['solutions:6', source]]) });
  const result = await service.repair('questions', 'q1');
  assert.equal(result.updated[0]?.explanation, '[See source diagram]');
  assert.equal(result.updated[0].chemistry?.status, 'needs_review');
  assert.deepEqual(result.unresolved, []);
  assert.equal(uploads.length, 1);
});
