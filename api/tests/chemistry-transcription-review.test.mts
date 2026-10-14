import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DocumentSchema, PassageSchema, QuestionSchema, type ChemistryExtraction, type Passage, type Question, type UpdatePassage, type UpdateQuestion } from '@ingest/contracts';
import { PublishService } from '../src/modules/publish/publish.service.js';
import { QuestionsService } from '../src/modules/questions/questions.service.js';
import { chemistrySmilesIssues } from '../src/modules/questions/chemistry-smiles-validation.js';
import type { SmilesValidator } from '../src/modules/questions/smiles-validator.js';

const validator: SmilesValidator = {
  validate: async (smiles) => smiles === 'BAD'
    ? { valid: false, message: 'The molecular graph is invalid.' }
    : { valid: true },
};
const PATH = { module: 'Allen', chapter: 'Chemistry', section: 'Reactions' };
const AT = '2026-10-14T00:00:00.000Z';

function metadata(status: ChemistryExtraction['status'] = 'needs_review'): ChemistryExtraction {
  return {
    version: 1, representation: 'transcription', status, issues: [],
    candidateStem: 'Reactant <smiles>CO</smiles>', candidateOptions: ['(A) <smiles>CCO</smiles>', '(B) Other product'],
    visuals: [
      { id: 'stem', field: 'stem', optionLabel: null, kind: 'molecule', bbox: [0, 0, 0.2, 0.2], moleculeCount: 1, candidateSmiles: ['CO'], graphValid: true, cropUrl: null },
      { id: 'option-a', field: 'option', optionLabel: 'A', kind: 'molecule', bbox: [0.2, 0.2, 0.2, 0.2], moleculeCount: 1, candidateSmiles: ['CCO'], graphValid: true, cropUrl: null },
    ],
  };
}

function question(overrides: Partial<Question> = {}): Question {
  return QuestionSchema.parse({
    id: 'q1', documentId: 'doc', questionNumber: 1, printedLabel: 'A-1', chemistry: metadata(), path: PATH,
    stem: 'Reactant <smiles>CO</smiles>', options: [{ label: 'A', body: '<smiles>CCO</smiles>', isCorrect: true }, { label: 'B', body: 'Other product', isCorrect: false }],
    answer: 'A', explanation: null, images: [], match: null, isQuestionImage: false, questionImage: null,
    isOptionImage: false, optionImages: [], questionType: 'single_correct', sectionName: 'Reactions', topic: null,
    subject: 'Chemistry', flagged: false, isPyq: false, pyqExam: null, pyqYear: null, paper: null,
    sourceRegion: { page: 1, bbox: [0, 0, 1, 1] }, createdAt: AT, updatedAt: AT,
    ...overrides,
  });
}

function passage(text: string): Passage {
  return PassageSchema.parse({ id: 'passage', documentId: 'doc', text, passageImage: null, createdAt: AT, updatedAt: AT });
}

function harness(initial: Question, input: { passages?: Passage[]; validator?: SmilesValidator | null } = {}): {
  edits: QuestionsService; publish: PublishService; saved: Question[]; writes: unknown[]; checked: string[];
} {
  let current = initial;
  let passages = input.passages ?? [];
  const saved: Question[] = [];
  const writes: unknown[] = [];
  const checked: string[] = [];
  const baseValidator = input.validator === undefined ? validator : input.validator;
  const graphValidator: SmilesValidator | null = baseValidator ? { validate: async (smiles) => { checked.push(smiles); return baseValidator.validate(smiles); } } : null;
  const document = DocumentSchema.parse({
    id: 'doc', sessionId: 'session', driveFileId: 'drive', fileName: 'chemistry.pdf', path: PATH, kind: 'question',
    sectionName: 'Reactions', questionType: 'single_correct', subject: 'Chemistry', exam: 'JEE', pyq: false,
    pyqExam: null, pyqYear: null, paper: null, source: 'module', pageRange: null, topics: [], status: 'extracted',
    flagged: false, questionCount: 1, extractedAt: null, deletedAt: null, createdAt: AT, updatedAt: AT,
  });
  const repository = {
    findById: async () => current, findByDocument: async () => [current], findPassagesByDocument: async () => passages,
    findPassageById: async (id: string) => passages.find((entry) => entry.id === id) ?? null,
    update: async (_id: string, patch: UpdateQuestion) => { current = QuestionSchema.parse({ ...current, ...patch }); saved.push(current); return current; },
    updatePassage: async (id: string, patch: UpdatePassage) => {
      const existing = passages.find((entry) => entry.id === id);
      assert.ok(existing);
      const updated = PassageSchema.parse({ ...existing, ...patch });
      passages = passages.map((entry) => entry.id === id ? updated : entry);
      return updated;
    },
    groupQuestions: async (documentId: string, passageId: string, questionIds: string[]) => {
      assert.equal(current.chemistry?.status, 'needs_review', 'Review must be invalidated before the grouping mutation changes source ownership.');
      assert.equal(documentId, current.documentId);
      assert.ok(questionIds.includes(current.id));
      const shared = PassageSchema.parse({ ...passage(''), id: passageId, documentId });
      current = QuestionSchema.parse({ ...current, passageId, groupOrder: questionIds.indexOf(current.id) });
      passages = [...passages, shared];
      return shared;
    },
    ungroupPassage: async (id: string) => {
      assert.equal(current.chemistry?.status, 'needs_review', 'Review must be invalidated before dissolving shared source ownership.');
      assert.equal(current.passageId, id);
      current = QuestionSchema.parse({ ...current, passageId: null, groupOrder: null });
      passages = passages.filter((entry) => entry.id !== id);
    },
  };
  type EditDependencies = ConstructorParameters<typeof QuestionsService>;
  type PublishDependencies = ConstructorParameters<typeof PublishService>;
  const edits = new QuestionsService(
    repository as unknown as EditDependencies[0], // A local fake implements only review/passage persistence.
    {} as EditDependencies[1], {} as EditDependencies[2], {} as EditDependencies[3], {} as EditDependencies[4],
    {} as EditDependencies[5], {} as EditDependencies[6], {} as EditDependencies[7], {} as EditDependencies[8], {} as EditDependencies[9],
    undefined, graphValidator,
  );
  const publish = new PublishService(
    { findById: async () => document, updateStatus: async () => undefined } as unknown as PublishDependencies[0],
    repository as unknown as PublishDependencies[1], // The bank and source document are separate local fakes.
    { upsertQuestions: async (rows) => { writes.push(...rows); return rows.length; } },
    { resolveQuestionTaxonomy: async () => ({}) } as unknown as PublishDependencies[3],
    graphValidator,
  );
  return { edits, publish, saved, writes, checked };
}

void test('valid rendered SMILES can be reviewed and published without automatically attached source crops', async () => {
  const original = question();
  const { edits, publish, checked, writes } = harness(original);
  assert.ok(original.chemistry);
  const reviewed = await edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } });
  assert.equal(reviewed.chemistry?.status, 'transcription_reviewed');
  assert.deepEqual(reviewed.optionImages, []);
  assert.equal(reviewed.questionImage, null);
  assert.deepEqual((await publish.listPublishIssues('doc')).issues, []);
  assert.deepEqual(await publish.publishDocument('doc'), { published: 1 });
  assert.deepEqual(new Set(checked), new Set(['CO', 'CCO']));
  const row = writes[0];
  assert.ok(row !== null && typeof row === 'object');
  assert.equal(Reflect.get(row, 'question_text'), original.stem);
  assert.deepEqual(Reflect.get(row, 'options'), original.options.map((option) => `(${option.label}) ${option.body}`));
  assert.equal(Reflect.get(row, 'question_image'), null);
});

void test('graph validity of the current correction is checked independently of a stale invalid audit candidate', async () => {
  const chemistry = metadata();
  const option = chemistry.visuals[1];
  assert.ok(option);
  option.candidateSmiles = ['BAD']; option.graphValid = false;
  const original = question({ chemistry });
  const { edits, checked } = harness(original);
  await edits.update('q1', { chemistry: { ...chemistry, status: 'transcription_reviewed' } });
  assert.deepEqual(checked, ['CO', 'CCO']);
});

void test('invalid molecules in every rendered field block both acceptance and actual bank publication', async () => {
  const productColumn = { title: 'Products', entries: [{ label: 'p', body: 'Product', image: null }] };
  const match = {
    columns: [{ title: 'Reactants', entries: [{ label: 'a', body: '<smiles>BAD</smiles>', image: null }] }, productColumn],
    key: { a: ['p'] },
  };
  const cases: Array<{ patch: Partial<Question>; passages?: Passage[]; field: string }> = [
    { patch: { stem: 'Reactant <smiles>BAD</smiles>' }, field: 'stem' },
    { patch: { answer: '<smiles>BAD</smiles>' }, field: 'answer' },
    { patch: { explanation: 'Product <smiles>BAD</smiles>' }, field: 'explanation' },
    { patch: { options: [{ label: 'A', body: '<smiles>BAD</smiles>', isCorrect: true }, { label: 'B', body: 'Other product', isCorrect: false }] }, field: 'option A' },
    { patch: { questionType: 'matrix', match }, field: 'matrix entry a' },
    { patch: { questionType: 'matrix', match: { ...match, columns: [{ title: '<smiles>BAD</smiles>', entries: [{ label: 'a', body: 'Reactant', image: null }] }, productColumn] } }, field: 'matrix heading' },
    { patch: { passageId: 'passage', groupOrder: 0 }, passages: [passage('Use <smiles>BAD</smiles>')], field: 'passage' },
  ];
  for (const entry of cases) {
    const original = question(entry.patch);
    const options = entry.passages ? { passages: entry.passages } : {};
    const { edits, saved } = harness(original, options);
    assert.ok(original.chemistry);
    await assert.rejects(edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(entry.field));
      return Reflect.get(error, 'code') === 'CHEMISTRY_REVIEW_INVALID';
    });
    assert.deepEqual(saved, []);
    const unsafe = question({ ...entry.patch, chemistry: metadata('transcription_reviewed') });
    const { publish, writes } = harness(unsafe, options);
    assert.ok((await publish.listPublishIssues('doc')).issues.some((issue) => issue.message.includes(entry.field)));
    await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
});

void test('a missing graph validator fails closed rather than accepting a syntactically plausible molecule', async () => {
  const original = question();
  const { edits, saved } = harness(original, { validator: null });
  assert.ok(original.chemistry);
  await assert.rejects(edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } }), /validator is unavailable/);
  assert.deepEqual(saved, []);
  assert.match((await chemistrySmilesIssues(original, null))[0] ?? '', /validator is unavailable/);
});

void test('editing any accepted molecular field resets review before a later publish', async () => {
  const accepted = question({ chemistry: metadata('transcription_reviewed') });
  const patches: UpdateQuestion[] = [
    { stem: 'Changed <smiles>CC</smiles>' }, { answer: '<smiles>CC</smiles>' }, { explanation: '<smiles>CC</smiles>' },
    { options: [{ label: 'A', body: '<smiles>CC</smiles>', isCorrect: true }, { label: 'B', body: 'Other product', isCorrect: false }] },
    { questionImage: 'https://source.test/manual.png', isQuestionImage: true },
  ];
  for (const patch of patches) {
    const { edits, publish, writes } = harness(accepted);
    const changed = await edits.update('q1', patch);
    assert.equal(changed.chemistry?.status, 'needs_review');
    await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
});

void test('a shared molecular passage edit invalidates every accepted attached transcription before publication', async () => {
  const accepted = question({ chemistry: metadata('transcription_reviewed'), passageId: 'passage', groupOrder: 0 });
  const { edits, publish, saved, writes } = harness(accepted, { passages: [passage('Use <smiles>CO</smiles>')] });
  const changed = await edits.updatePassage('passage', { text: 'Changed reaction <smiles>CCO</smiles>' });
  assert.equal(changed.text, 'Changed reaction <smiles>CCO</smiles>');
  assert.equal(saved[0]?.chemistry?.status, 'needs_review');
  await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
});

void test('grouping an accepted molecular question invalidates its review before creating new passage ownership', async () => {
  const accepted = question({ chemistry: metadata('transcription_reviewed') });
  const { edits, publish, saved, writes } = harness(accepted);
  const created = await edits.groupQuestions('doc', ['q1']);
  assert.equal(created.documentId, accepted.documentId);
  assert.equal(saved[0]?.chemistry?.status, 'needs_review');
  await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
});

void test('ungrouping accepted molecular questions invalidates review before removing the shared source', async () => {
  const accepted = question({ chemistry: metadata('transcription_reviewed'), passageId: 'passage', groupOrder: 0 });
  const { edits, publish, saved, writes } = harness(accepted, { passages: [passage('Use <smiles>CO</smiles>')] });
  await edits.ungroupPassage('passage');
  assert.equal(saved[0]?.chemistry?.status, 'needs_review');
  await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
});

void test('an empty shared chemistry passage blocks acceptance and publication until readable content or an explicit fallback image exists', async () => {
  for (const text of ['', '   ']) {
    const original = question({ passageId: 'passage', groupOrder: 0 });
    assert.ok(original.chemistry);
    const { edits, saved } = harness(original, { passages: [passage(text)] });
    await assert.rejects(edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } }), /shared chemistry passage needs readable text/);
    assert.deepEqual(saved, []);
    const accepted = question({ ...original, chemistry: metadata('transcription_reviewed') });
    const { publish, writes } = harness(accepted, { passages: [passage(text)] });
    await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
  const original = question({ passageId: 'passage', groupOrder: 0 });
  assert.ok(original.chemistry);
  const manual = { ...passage(''), passageImage: 'https://source.test/manual-passage.png' };
  const { edits, publish, writes } = harness(original, { passages: [manual] });
  await edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } });
  await publish.publishDocument('doc');
  assert.equal(writes.length, 1);
});

void test('a malformed or empty SMILES tag blocks acceptance before a graph parser can mistake omitted content for valid text', async () => {
  for (const stem of ['Use <smiles>CO', 'Use <smiles></smiles>', 'Use CO</smiles>']) {
    const original = question({ stem });
    assert.ok(original.chemistry);
    const { edits, checked, saved } = harness(original);
    await assert.rejects(edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } }), /incomplete or empty SMILES/);
    assert.deepEqual(checked, []);
    assert.deepEqual(saved, []);
  }
});

void test('an unseen unresolved marker blocks review in answers, matrix entries and shared passages even without a source ledger', async () => {
  const marker = '[Unresolved molecular structure: unreadable ring]';
  const noLedger = { ...metadata(), visuals: [] };
  const matrix = {
    columns: [{ title: 'Reactants', entries: [{ label: 'a', body: marker, image: null }] }, { title: 'Products', entries: [{ label: 'p', body: 'Product', image: null }] }],
    key: { a: ['p'] },
  };
  const cases: Array<{ patch: Partial<Question>; passages?: Passage[] }> = [
    { patch: { answer: marker } },
    { patch: { questionType: 'matrix', match: matrix } },
    { patch: { passageId: 'passage', groupOrder: 0 }, passages: [passage(marker)] },
  ];
  for (const entry of cases) {
    const original = question({ ...entry.patch, chemistry: noLedger, isQuestionImage: true, questionImage: 'https://source.test/unrelated-stem-crop.png' });
    const { edits, saved } = harness(original, entry.passages ? { passages: entry.passages } : {});
    await assert.rejects(edits.update('q1', { chemistry: { ...noLedger, status: 'transcription_reviewed' } }), /unresolved molecular structure/);
    assert.deepEqual(saved, []);
    const unsafe = question({ ...original, chemistry: { ...noLedger, status: 'transcription_reviewed' } });
    const { publish, writes } = harness(unsafe, entry.passages ? { passages: entry.passages } : {});
    await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
    assert.deepEqual(writes, []);
  }
});

void test('an unresolved marker can use a manually selected last-resort crop only in its exact owning field', async () => {
  const marker = '[Unresolved molecular structure: unreadable ring]';
  const noLedger = { ...metadata(), visuals: [] };
  const url = 'https://source.test/manual-fallback.png';
  const matrix = {
    columns: [{ title: 'Reactants', entries: [{ label: 'a', body: marker, image: url }] }, { title: 'Products', entries: [{ label: 'p', body: 'Product', image: null }] }],
    key: { a: ['p'] },
  };
  const cases: Array<{ patch: Partial<Question>; passages?: Passage[] }> = [
    { patch: { answer: marker, answerImages: [url] } },
    { patch: { questionType: 'matrix', match: matrix } },
    { patch: { passageId: 'passage', groupOrder: 0 }, passages: [{ ...passage(marker), passageImage: url }] },
  ];
  for (const entry of cases) {
    const original = question({ ...entry.patch, chemistry: noLedger });
    const { edits, publish, writes } = harness(original, entry.passages ? { passages: entry.passages } : {});
    const accepted = await edits.update('q1', { chemistry: { ...noLedger, status: 'transcription_reviewed' } });
    assert.equal(accepted.chemistry?.status, 'transcription_reviewed');
    await publish.publishDocument('doc');
    assert.equal(writes.length, 1);
  }
});

void test('an explicitly selected last-resort crop can replace one unresolved option while other SMILES remain rendered', async () => {
  const original = question({ options: [{ label: 'A', body: 'Unresolved drawing', isCorrect: true }, { label: 'B', body: 'Other product', isCorrect: false }] });
  const { edits, publish, writes, checked } = harness(original);
  assert.ok(original.chemistry);
  const accepted = await edits.update('q1', {
    chemistry: { ...original.chemistry, status: 'transcription_reviewed' },
    isOptionImage: true, optionImages: ['https://source.test/manual-option.png', ''],
  });
  assert.equal(accepted.stem, original.stem);
  assert.equal(accepted.chemistry?.representation, 'transcription');
  await publish.publishDocument('doc');
  const row = writes[0];
  assert.ok(row !== null && typeof row === 'object');
  assert.deepEqual(Reflect.get(row, 'option_images'), accepted.optionImages);
  assert.deepEqual(new Set(checked), new Set(['CO']));
});

void test('attaching a last-resort crop cannot hide an invalid SMILES token that remains student-visible', async () => {
  const original = question({ options: [{ label: 'A', body: '<smiles>BAD</smiles>', isCorrect: true }, { label: 'B', body: 'Other product', isCorrect: false }], isOptionImage: true, optionImages: ['https://source.test/manual.png', ''] });
  assert.ok(original.chemistry);
  const { edits, saved } = harness(original);
  await assert.rejects(edits.update('q1', { chemistry: { ...original.chemistry, status: 'transcription_reviewed' } }), { code: 'CHEMISTRY_REVIEW_INVALID' });
  assert.deepEqual(saved, []);
});

void test('a source-image review stamp is not sufficient to publish a SMILES transcription', async () => {
  const { publish, writes } = harness(question({ chemistry: metadata('source_preserved') }));
  await assert.rejects(publish.publishDocument('doc'), { code: 'CHEMISTRY_NOT_PUBLISHABLE' });
  assert.deepEqual(writes, []);
});
