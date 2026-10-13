import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DocumentSchema,
  PassageSchema,
  QuestionSchema,
  UpdateQuestionSchema,
  type ChemistryExtraction,
  type Document,
  type Passage,
  type Question,
  type UpdateQuestion,
} from '@ingest/contracts';
import { PublishService } from '../src/modules/publish/publish.service.js';
import { QuestionsService } from '../src/modules/questions/questions.service.js';
import { chemistrySourceReviewIssues } from '../src/modules/questions/chemistry-source-review.js';

const STEM_URL = 'https://storage.example/source-stem.png';
const OPTION_URL = 'https://storage.example/source-option-a.png';

function metadata(status: ChemistryExtraction['status'] = 'needs_review'): ChemistryExtraction {
  return {
    version: 1,
    status,
    issues: ['Candidate ring topology needs review.'],
    candidateStem: '<smiles>C1CCCCCC1</smiles> + reagent',
    candidateOptions: ['(A) <smiles>invalid</smiles>', '(F) Second source option'],
    visuals: [
      { id: 'stem:source', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0, 0, 1, 0.3], candidateSmiles: ['C1CCCCCC1'], graphValid: true, cropUrl: STEM_URL },
      { id: 'option:A', field: 'option', optionLabel: 'A', kind: 'molecule', bbox: [0, 0.4, 0.5, 0.2], candidateSmiles: ['invalid'], graphValid: false, cropUrl: OPTION_URL },
    ],
  };
}

function sourceQuestion(overrides: Partial<Question> = {}): Question {
  return QuestionSchema.parse({
    id: 'q1',
    documentId: 'doc',
    questionNumber: 3,
    printedLabel: 'B-3',
    chemistry: metadata(),
    path: { module: 'Resonance', chapter: 'Chemistry', section: 'Section B' },
    stem: '',
    options: [{ label: 'A', body: '', isCorrect: true }, { label: 'F', body: 'Second source option', isCorrect: false }],
    answer: 'A',
    explanation: null,
    images: [],
    match: null,
    isQuestionImage: true,
    questionImage: STEM_URL,
    isOptionImage: true,
    optionImages: [OPTION_URL, ''],
    questionType: 'single_correct',
    sectionName: 'Section B',
    topic: null,
    subject: 'Chemistry',
    flagged: false,
    isPyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    sourceRegion: { page: 9, bbox: [0, 0, 1, 1] },
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  });
}

function sourceDocument(): Document {
  return DocumentSchema.parse({
    id: 'doc',
    sessionId: 'session',
    driveFileId: 'drive',
    fileName: 'chemistry.pdf',
    path: { module: 'Resonance', chapter: 'Chemistry', section: 'Section B' },
    kind: 'question',
    sectionName: 'Section B',
    questionType: 'single_correct',
    exam: 'NEET',
    subject: 'Chemistry',
    pyq: false,
    pyqExam: null,
    pyqYear: null,
    paper: null,
    source: 'module',
    pageRange: null,
    topics: [],
    status: 'extracted',
    flagged: false,
    questionCount: 1,
    extractedAt: null,
    deletedAt: null,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  });
}

function sourcePassage(text: string, passageImage: string | null = null): Passage {
  return PassageSchema.parse({
    id: 'passage', documentId: 'doc', text, passageImage,
    createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
  });
}

function publication(question: Question, passages: Passage[] = []): { service: PublishService; writes: unknown[]; statusWrites: string[] } {
  const document = sourceDocument();
  const writes: unknown[] = [];
  const statusWrites: string[] = [];
  type Dependencies = ConstructorParameters<typeof PublishService>;
  const service = new PublishService(
    {
      findById: async () => document,
      updateStatus: async (_id: string, status: string) => { statusWrites.push(status); },
    } as unknown as Dependencies[0],
    { findByDocument: async () => [question], findPassagesByDocument: async () => passages } as unknown as Dependencies[1],
    { upsertQuestions: async (rows) => { writes.push(...rows); return rows.length; } },
    { resolveQuestionTaxonomy: async () => ({}) } as unknown as Dependencies[3],
  );
  return { service, writes, statusWrites };
}

function editing(question: Question, passages: Passage[] = []): { service: QuestionsService; saved: Question[] } {
  const saved: Question[] = [];
  type Dependencies = ConstructorParameters<typeof QuestionsService>;
  const repository = {
    findById: async () => question,
    findPassagesByDocument: async () => passages,
    update: async (_id: string, patch: UpdateQuestion) => {
      const updated = QuestionSchema.parse({ ...question, ...patch });
      saved.push(updated);
      return updated;
    },
  };
  const service = new QuestionsService(
    repository as unknown as Dependencies[0],
    {} as Dependencies[1], {} as Dependencies[2], {} as Dependencies[3], {} as Dependencies[4],
    {} as Dependencies[5], {} as Dependencies[6], {} as Dependencies[7], {} as Dependencies[8], {} as Dependencies[9],
  );
  return { service, saved };
}

void test('unreviewed chemistry blocks both publish issues and actual bank write', async () => {
  const { service, writes, statusWrites } = publication(sourceQuestion());
  const preflight = await service.listPublishIssues('doc');
  assert.equal(preflight.issues.length, 1);
  const issue = preflight.issues[0];
  assert.ok(issue);
  assert.equal(issue.questionId, 'q1');
  assert.match(issue.message, /reviewer acceptance/);
  await assert.rejects(service.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
  assert.deepEqual(statusWrites, []);
});

void test('accepted source fallback publishes the source despite invalid audit-only graph candidates', async () => {
  const { service, writes, statusWrites } = publication(sourceQuestion({ chemistry: metadata('source_preserved') }));
  assert.deepEqual((await service.listPublishIssues('doc')).issues, []);
  assert.deepEqual(await service.publishDocument('doc'), { published: 1 });
  const row = writes[0];
  assert.ok(row !== null && typeof row === 'object');
  assert.equal(Reflect.get(row, 'question_text'), '');
  assert.equal(Reflect.get(row, 'question_image'), STEM_URL);
  assert.deepEqual(Reflect.get(row, 'option_images'), [OPTION_URL, '']);
  assert.deepEqual(statusWrites, ['published']);
});

void test('preflight reports chemistry review even when a matrix has another structural blocker', async () => {
  const { service } = publication(sourceQuestion({ questionType: 'matrix', match: null }));
  const result = await service.listPublishIssues('doc');
  assert.equal(result.issues.length, 2);
  assert.ok(result.issues.some((issue) => issue.message.includes('matching columns/key')));
  assert.ok(result.issues.some((issue) => issue.message.includes('reviewer acceptance')));
});

void test('accepted status cannot hide missing, unmapped or contradictory source representations', async () => {
  const missingCrop = metadata('source_preserved');
  const firstVisual = missingCrop.visuals[0];
  assert.ok(firstVisual);
  firstVisual.cropUrl = null;
  const cases: Partial<Question>[] = [
    { chemistry: missingCrop },
    { isQuestionImage: false },
    { questionImage: 'https://storage.example/unrelated.png' },
    { questionImage: `${STEM_URL},https://storage.example/extra-figure.png` },
    { isOptionImage: false },
    { optionImages: ['', OPTION_URL] },
    { options: [{ label: 'Z', body: '', isCorrect: true }, { label: 'F', body: 'Second source option', isCorrect: false }] },
    { stem: '<smiles>C1CCCCCC1</smiles>' },
    { options: [{ label: 'A', body: '<smiles>C1CCCCCC1</smiles>', isCorrect: true }, { label: 'F', body: 'Second source option', isCorrect: false }] },
  ];
  for (const patch of cases) {
    const question = sourceQuestion({ chemistry: metadata('source_preserved'), ...patch });
    const { service, writes } = publication(question);
    assert.ok(chemistrySourceReviewIssues(question).length > 0);
    assert.equal((await service.listPublishIssues('doc')).issues.length, 1);
    await assert.rejects(service.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
});

void test('reviewer can accept existing complete source crops through ordinary PATCH', async () => {
  const question = sourceQuestion();
  assert.ok(question.chemistry);
  const patch = UpdateQuestionSchema.parse({ chemistry: { ...question.chemistry, status: 'source_preserved' } });
  const { service, saved } = editing(question);
  const updated = await service.update(question.id, patch);
  assert.equal(updated.chemistry?.status, 'source_preserved');
  assert.equal(saved.length, 1);
});

void test('acceptance rejects forged ledgers, ledger removal, missing crops and concurrent candidate text', async () => {
  const question = sourceQuestion();
  assert.ok(question.chemistry);
  for (const patch of [
    { chemistry: null },
    { chemistry: { ...question.chemistry, status: 'source_preserved', visuals: [] } },
    { chemistry: { ...question.chemistry, status: 'source_preserved' }, questionImage: null },
    { chemistry: { ...question.chemistry, status: 'source_preserved' }, optionImages: ['', ''] },
    { chemistry: { ...question.chemistry, status: 'source_preserved' }, stem: 'A guessed replacement reaction.' },
  ]) {
    const { service, saved } = editing(question);
    await assert.rejects(service.update(question.id, UpdateQuestionSchema.parse(patch)), { code: 'CHEMISTRY_REVIEW_INVALID' });
    assert.deepEqual(saved, []);
  }
});

void test('edits that change accepted crop ownership invalidate its previous source review', async () => {
  const question = sourceQuestion({ chemistry: metadata('source_preserved') });
  for (const patch of [{ optionImages: ['', OPTION_URL] }, { stem: 'Candidate replacement' }, { isQuestionImage: false }, { questionImage: `${STEM_URL},https://storage.example/extra-figure.png` }]) {
    const { service } = editing(question);
    const updated = await service.update(question.id, patch);
    assert.equal(updated.chemistry?.status, 'needs_review');
  }
  const { service } = editing(question);
  const answerEdit = await service.update(question.id, { answer: 'F' });
  assert.equal(answerEdit.chemistry?.status, 'source_preserved');
});

void test('adding a supplementary stem URL invalidates source review and blocks the resulting bank write', async () => {
  const question = sourceQuestion({ chemistry: metadata('source_preserved') });
  const { service: updates } = editing(question);
  const changed = await updates.update(question.id, { questionImage: `${STEM_URL},https://storage.example/extra-figure.png` });
  assert.equal(changed.chemistry?.status, 'needs_review');
  const { service: publishing, writes } = publication(changed);
  await assert.rejects(publishing.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
  assert.ok(changed.chemistry);
  const { service: reviewer } = editing(changed);
  await assert.rejects(reviewer.update(changed.id, { chemistry: { ...changed.chemistry, status: 'source_preserved' } }), { code: 'CHEMISTRY_REVIEW_INVALID' });
});

void test('matrix candidates cannot escape review through rendered entries even alongside images', async () => {
  for (const entryImage of [null, 'https://storage.example/matrix-entry.png']) {
    const match = {
      columns: [
        { title: 'Column I', entries: [{ label: 'a', body: '<smiles>C1CCCCCC1</smiles>', image: entryImage }, { label: 'b', body: 'Text entry', image: null }] },
        { title: 'Column II', entries: [{ label: 'p', body: 'First result', image: null }, { label: 'q', body: 'Second result', image: null }] },
      ],
      key: { a: ['p'], b: ['q'] },
    };
    const question = sourceQuestion({ chemistry: metadata('source_preserved'), questionType: 'matrix', match });
    const { service, writes } = publication(question);
    assert.ok((await service.listPublishIssues('doc')).issues.some((issue) => issue.message.includes('Matrix entry a')));
    await assert.rejects(service.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
    const reviewable = sourceQuestion({ questionType: 'matrix', match });
    assert.ok(reviewable.chemistry);
    const { service: updates, saved } = editing(reviewable);
    await assert.rejects(updates.update('q1', { chemistry: { ...reviewable.chemistry, status: 'source_preserved' } }), { code: 'CHEMISTRY_REVIEW_INVALID' });
    assert.deepEqual(saved, []);
  }
});

void test('shared passage candidates block acceptance and publication despite a passage image', async () => {
  const question = sourceQuestion({ chemistry: metadata('source_preserved'), passageId: 'passage', groupOrder: 0 });
  for (const image of [null, 'https://storage.example/passage.png']) {
    const passage = sourcePassage('Use <smiles>C1CCCCCC1</smiles> in this reaction.', image);
    const { service, writes } = publication(question, [passage]);
    assert.ok((await service.listPublishIssues('doc')).issues.some((issue) => issue.message.includes('shared passage still renders')));
    await assert.rejects(service.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
    const reviewable = sourceQuestion({ passageId: 'passage', groupOrder: 0 });
    assert.ok(reviewable.chemistry);
    const { service: updates, saved } = editing(reviewable, [passage]);
    await assert.rejects(updates.update('q1', { chemistry: { ...reviewable.chemistry, status: 'source_preserved' } }), { code: 'CHEMISTRY_REVIEW_INVALID' });
    assert.deepEqual(saved, []);
  }
});

void test('source-only passage fallback can be reviewed while empty or missing passages stay blocked', async () => {
  const question = sourceQuestion({ passageId: 'passage', groupOrder: 0 });
  assert.ok(question.chemistry);
  const patch: UpdateQuestion = { chemistry: { ...question.chemistry, status: 'source_preserved' } };
  const sourceOnly = sourcePassage('', 'https://storage.example/passage.png');
  const { service } = editing(question, [sourceOnly]);
  const accepted = await service.update('q1', patch);
  assert.equal(accepted.chemistry?.status, 'source_preserved');
  const { service: publishing } = publication(accepted, [sourceOnly]);
  assert.deepEqual(await publishing.publishDocument('doc'), { published: 1 });
  for (const passages of [[], [sourcePassage('')]]) {
    const { service: blocked, saved } = editing(question, passages);
    await assert.rejects(blocked.update('q1', patch), { code: 'CHEMISTRY_REVIEW_INVALID' });
    assert.deepEqual(saved, []);
  }
});

void test('answer and worked-solution candidates cannot bypass source review by attaching images', async () => {
  for (const field of ['answer', 'explanation'] as const) {
    const candidate = 'Use <smiles>C1CCCCCC1</smiles> after reduction.';
    const images = field === 'answer'
      ? { answerImages: ['https://storage.example/answer.png'] }
      : { explanationImages: ['https://storage.example/solution.png'] };
    const question = sourceQuestion({ chemistry: metadata('source_preserved'), [field]: candidate, ...images });
    const { service, writes } = publication(question);
    assert.ok((await service.listPublishIssues('doc')).issues.some((issue) => issue.message.includes(field === 'answer' ? 'answer still renders' : 'worked solution still renders')));
    await assert.rejects(service.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
    const reviewable = sourceQuestion({ [field]: candidate, ...images });
    assert.ok(reviewable.chemistry);
    const { service: updates, saved } = editing(reviewable);
    await assert.rejects(updates.update('q1', { chemistry: { ...reviewable.chemistry, status: 'source_preserved' } }), { code: 'CHEMISTRY_REVIEW_INVALID' });
    assert.deepEqual(saved, []);
    const { service: acceptedUpdates } = editing(sourceQuestion({ chemistry: metadata('source_preserved') }));
    const changed = await acceptedUpdates.update('q1', { [field]: candidate });
    assert.equal(changed.chemistry?.status, 'needs_review');
  }
});

void test('answer and solution source images can replace molecular tokens while preserving prose and math', async () => {
  const reviewable = sourceQuestion({
    answer: 'Product <smiles>C1CCCCCC1</smiles>',
    explanation: 'Reduction yields <smiles>C1CCCCCC1</smiles> at \\(25^\\circ\\mathrm{C}\\).',
  });
  assert.ok(reviewable.chemistry);
  const { service } = editing(reviewable);
  const accepted = await service.update('q1', {
    chemistry: { ...reviewable.chemistry, status: 'source_preserved' },
    answer: 'Product shown in the source image.',
    explanation: 'Reduction at \\(25^\\circ\\mathrm{C}\\); product shown in the source image.',
    answerImages: ['https://storage.example/answer.png'],
    explanationImages: ['https://storage.example/solution.png'],
  });
  assert.equal(accepted.chemistry?.status, 'source_preserved');
  assert.match(accepted.explanation ?? '', /25/);
  const { service: publishing, writes } = publication(accepted);
  assert.deepEqual(await publishing.publishDocument('doc'), { published: 1 });
  const row = writes[0];
  assert.ok(row !== null && typeof row === 'object');
  assert.equal(Reflect.get(row, 'answer_image'), accepted.answerImages[0]);
  assert.equal(Reflect.get(row, 'solution_image'), accepted.explanationImages[0]);
});

void test('adding a molecule to a previously text-only field cannot escape the visual ledger', async () => {
  const noVisuals = { ...metadata('source_preserved'), visuals: [] };
  const question = sourceQuestion({ chemistry: noVisuals });
  for (const patch of [
    { stem: 'Use <smiles>C1CCCCCC1</smiles>' },
    { options: [{ label: 'A', body: '', isCorrect: true }, { label: 'F', body: '<smiles>C1CCCCCC1</smiles>', isCorrect: false }] },
  ]) {
    const { service: updates } = editing(question);
    const edited = await updates.update('q1', patch);
    assert.equal(edited.chemistry?.status, 'needs_review');
    const unsafe = sourceQuestion({ chemistry: noVisuals, ...patch });
    const { service: publishing, writes } = publication(unsafe);
    await assert.rejects(publishing.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
});
