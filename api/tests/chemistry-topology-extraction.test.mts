import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { chemistrySourceReviewIssues, DocumentSchema, QuestionSchema } from '@ingest/contracts';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import { mergeAnswerEntries } from '../src/modules/extraction/vision-extractor.js';
import { toNewQuestion } from '../src/modules/extraction/extraction.worker.js';
import type { ExtractedQuestion } from '../src/modules/extraction/index.js';

const document = DocumentSchema.parse({
  id: 'source-document', driveFileId: 'source-file', fileName: 'chemistry.pdf', path: { module: 'provider', chapter: 'Chemistry', section: 'exercise' },
  kind: 'question', questionType: 'subjective', subject: 'Chemistry', status: 'uploaded', questionCount: 0,
  sessionId: null, sectionName: 'exercise', exam: null, pyq: false, pyqExam: null, pyqYear: null,
  paper: null, source: 'module', pageRange: null, topics: [], flagged: false, deletedAt: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), extractedAt: null,
});
const inventory = { page_role: 'questions', question_regions: [{
  printed_label: 'B-3', source_section: 'exercise', bbox: [50, 100, 950, 900], source_regions: [],
  stem_bbox: [50, 100, 950, 900], stem_regions: [], visual_kind: 'molecule', molecule_count: 1, options: [],
}] };
function topology(id: string): unknown {
  return {
    id, readability: 'clear',
    atoms: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, element: 'C', x: 500 + 200 * Math.cos(2 * Math.PI * index / 5), y: 500 + 200 * Math.sin(2 * Math.PI * index / 5), charge: 0, isotope: 0, hydrogens: null })),
    bonds: Array.from({ length: 5 }, (_, index) => ({ begin: index + 1, end: ((index + 1) % 5) + 1, order: 1, stereo: 'none' })),
    rings: [[1, 2, 3, 4, 5]], notes: [],
  };
}
function fixture(responses: unknown[]): { vision: OpenAiVisionExtractor; requests: unknown[] } {
  const requests: unknown[] = [];
  const vision = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(vision, { client: { chat: { completions: { create: async (request: unknown) => {
    requests.push(request);
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected model call');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  } } } } });
  return { vision, requests };
}
async function png(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
}

void test('missing primary molecules trigger one localized retry, then independent topology repairs the exact slot', async () => {
  const primary = { questions: [{ question_number: 3, printed_label: 'B-3', question_text: 'Identify the structure.', options: [] }] };
  const retry = { questions: [{ question_number: 3, printed_label: 'B-3', question_text: 'Identify <smiles>C1CCCCC1</smiles>.', options: [] }] };
  const { vision, requests } = fixture([inventory, primary, retry, { molecules: [topology('/questions/0/question_text/smiles/0')], source_counts: [{ field_path: '/questions/0/question_text', observed_molecule_count: 1 }] }]);
  const result = await vision.extractQuestions({ document, pages: [{ pageNumber: 9, png: await png() }] });
  assert.equal(requests.length, 4);
  assert.match(JSON.stringify(requests[2]), /INCOMPLETE MOLECULAR TRANSCRIPTION/);
  assert.doesNotMatch(JSON.stringify(requests[3]), /C1CCCCC1/);
  assert.match(JSON.stringify(requests[3]), /\[MOLECULE\]/);
  const question = result.questions[0];
  assert.ok(question?.chemistry);
  const audit = question.chemistry.molecularAudits?.[0];
  assert.ok(audit);
  assert.equal(question.questionText, 'Identify <smiles>C1CCCC1</smiles>.');
  assert.equal(question.chemistry.representation, 'transcription');
  assert.equal(audit.status, 'corrected');
  assert.equal(audit.sourceDocumentId, document.id);
  assert.equal(audit.sourcePage, 9);
  assert.deepEqual(question.chemistry.issues, []);
});

void test('unrecovered molecular coverage remains a visible incomplete transcription and never becomes a question image', async () => {
  const primary = { questions: [{ question_number: 3, printed_label: 'B-3', question_text: 'Identify [Unresolved molecular structure: fused edge blurred].', options: [] }] };
  const { vision, requests } = fixture([inventory, primary, primary, { molecules: [], source_counts: [{ field_path: '/questions/0/question_text', observed_molecule_count: 1 }] }]);
  const result = await vision.extractQuestions({ document, pages: [{ pageNumber: 9, png: await png() }] });
  assert.equal(requests.length, 4);
  assert.equal(result.questions[0]?.questionText, primary.questions[0]?.question_text);
  assert.ok(result.questions[0]?.chemistry?.issues.some((issue) => /0 SMILES molecules.*1 independently counted/.test(issue)));
  assert.ok(result.questions[0]?.chemistry?.issues.some((issue) => /source contains 1 drawn molecules.*transcription contains 0/.test(issue)));
  assert.equal(result.questions[0]?.chemistry?.visuals[0]?.cropUrl, null);
});

void test('compact molecular answer maps retain independent audit ownership and corrected SMILES', async () => {
  const { vision } = fixture([
    { sections: [{ section_name: 'exercise', answers: { 'B-3': '<smiles>C1CCCCC1</smiles>' } }] },
    { molecules: [topology('/sections/0/answers/B-3/smiles/0')], source_counts: [{ field_path: '/sections/0/answers/B-3', observed_molecule_count: 1 }] },
  ]);
  const result = await vision.extractAnswers({ document: { ...document, kind: 'answer' }, pages: [{ pageNumber: 2, png: await png() }] });
  const entry = result.sheets[0]?.entries['B-3'];
  const audit = entry?.molecularAudits?.[0];
  assert.ok(entry && audit);
  assert.equal(entry.answer, '<smiles>C1CCCC1</smiles>');
  assert.equal(audit.status, 'corrected');
  assert.equal(audit.sourcePage, 2);
});

void test('a declared solution drawing with zero SMILES gets independent counting and one targeted recovery read', async () => {
  const primary = { sections: [{ section_name: 'exercise', solutions: { 'B-3': {
    answer: null, explanation: 'The product is shown.', answer_visual_kind: 'none', explanation_visual_kind: 'molecule', source_bbox: [50, 100, 950, 900],
  } } }] };
  const recovered = { sections: [{ section_name: 'exercise', solutions: { 'B-3': {
    answer: null, explanation: 'The product is <smiles>C1CCCCC1</smiles>.', answer_visual_kind: 'none', explanation_visual_kind: 'molecule', source_bbox: [50, 100, 950, 900],
  } } }] };
  const { vision, requests } = fixture([
    primary,
    { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 1 }] },
    recovered,
    { molecules: [topology('/sections/0/solutions/B-3/explanation/smiles/0')], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 1 }] },
  ]);
  const result = await vision.extractSolutions({ document: { ...document, kind: 'solution' }, pages: [{ pageNumber: 7, png: await png() }] });
  assert.equal(requests.length, 4);
  assert.match(JSON.stringify(requests[2]), /INCOMPLETE MOLECULAR TRANSCRIPTION/);
  assert.match(JSON.stringify(requests[1]), /candidateCount[^0-9]*0/);
  const entry = result.sheets[0]?.entries['B-3'];
  assert.ok(entry);
  assert.equal(entry.explanation, 'The product is <smiles>C1CCCC1</smiles>.');
  const audit = entry.molecularAudits?.[0];
  assert.ok(audit);
  assert.equal(audit.status, 'corrected');
  assert.equal(audit.sourcePage, 7);
  assert.equal(entry.sourceMoleculeCounts?.explanation, 1);
});

void test('a failed recovery preserves independent positive counts even without kinds, tags or source boxes', async () => {
  for (const withBox of [true, false]) {
    const sourceBox = withBox ? { source_bbox: [50, 100, 950, 900] } : {};
    const primary = { sections: [{ section_name: 'exercise', solutions: { 'B-3': { answer: null, explanation: 'Product drawing.', explanation_visual_kind: 'reaction', ...sourceBox } } }] };
    const retry = { sections: [{ section_name: 'exercise', solutions: { 'B-3': { answer: null, explanation: 'Product cannot be read.', explanation_visual_kind: 'none', ...sourceBox } } }] };
    const { vision, requests } = fixture([
      primary,
      { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 2 }] },
      retry,
      { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 2 }] },
    ]);
    const result = await vision.extractSolutions({ document: { ...document, kind: 'solution' }, pages: [{ pageNumber: 7, png: await png() }] });
    assert.equal(requests.length, 4);
    const entry = result.sheets[0]?.entries['B-3'];
    assert.ok(entry);
    assert.equal(entry.sourceMoleculeCounts?.explanation, 2);
    if (withBox) assert.equal(entry.chemistryVisuals?.[0]?.moleculeCount, 2);
    else assert.equal(entry.chemistryVisuals, undefined);
    const draft: ExtractedQuestion = {
      questionNumber: 3, printedLabel: 'B-3', questionText: 'Find the product.', options: [], answer: null, explanation: null,
      sectionName: 'exercise', questionType: 'subjective', level: null, difficultyConfidence: null, sourcePage: 9,
      pyqExam: null, pyqYear: null, match: null, passage: null, passageId: null, groupOrder: null,
    };
    const merged = mergeAnswers([draft], result.sheets, [])[0];
    assert.ok(merged);
    const row = QuestionSchema.parse({ ...toNewQuestion(document, merged, { model: 'test', at: new Date(0).toISOString() }), id: 'question', flagged: false, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
    assert.equal(row.chemistry?.sourceMoleculeCounts?.explanation, 2);
    assert.ok(chemistrySourceReviewIssues(row).some((issue) => /Worked solution: 0 of 2 inventoried molecules/.test(issue)));
    assert.equal(row.explanation, 'Product cannot be read.');
    assert.deepEqual(row.explanationImages, []);
  }
});

void test('independent solution counts follow prose deduplication, continuation and canonical answer priority', () => {
  const first = { answer: '<smiles>CO</smiles>', explanation: 'Product <smiles>CO</smiles>.', answerSource: 'solution' as const, sourceMoleculeCounts: { answer: 1, explanation: 1 } };
  const repeated = mergeAnswerEntries(first, { ...first });
  assert.deepEqual(repeated.sourceMoleculeCounts, { answer: 1, explanation: 1 });
  const continued = mergeAnswerEntries(repeated, { answer: null, explanation: 'Then <smiles>CCO</smiles> and <smiles>O</smiles>.', answerSource: 'solution', sourceMoleculeCounts: { explanation: 2 } });
  assert.deepEqual(continued.sourceMoleculeCounts, { answer: 1, explanation: 3 });
  const canonical = mergeAnswerEntries(continued, { answer: 'A', explanation: null, answerSource: 'answer_key' });
  assert.deepEqual(canonical.sourceMoleculeCounts, { explanation: 3 });
});

void test('a completeness retry cannot rename or drop a printed solution entry to evade its missing molecule', async () => {
  const primary = { sections: [{ section_name: 'exercise', solutions: { 'B-3': { answer: null, explanation: 'Product drawing.', explanation_visual_kind: 'molecule' } } }] };
  const { vision, requests } = fixture([
    primary,
    { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 1 }] },
    { sections: [{ section_name: 'exercise', solutions: { 'A-3': { answer: null, explanation: 'Other source.' } } }] },
  ]);
  const result = await vision.extractCompanion({ document: { ...document, kind: 'answer' }, pages: [{ pageNumber: 7, png: await png() }] });
  assert.equal(requests.length, 3);
  assert.deepEqual(Object.keys(result.sheets[0]?.entries ?? {}), ['B-3']);
  const entry = result.sheets[0]?.entries['B-3'];
  assert.ok(entry);
  assert.equal(entry.explanation, 'Product drawing.');
  assert.ok(entry.chemistryIssues?.some((issue) => /source contains 1 drawn molecules.*transcription contains 0/.test(issue)));
});

void test('a final topology outage cannot discard the source molecule count found before a completeness retry', async () => {
  const primary = { sections: [{ section_name: 'exercise', solutions: { 'B-3': { answer: null, explanation: 'Product drawing.', explanation_visual_kind: 'molecule' } } }] };
  const retry = { sections: [{ section_name: 'exercise', solutions: { 'B-3': { answer: null, explanation: 'Unreadable product.', explanation_visual_kind: 'none' } } }] };
  const { vision, requests } = fixture([primary, { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 1 }] }, retry]);
  const result = await vision.extractSolutions({ document: { ...document, kind: 'solution' }, pages: [{ pageNumber: 7, png: await png() }] });
  assert.equal(requests.length, 4);
  const entry = result.sheets[0]?.entries['B-3'];
  assert.ok(entry);
  assert.equal(entry.sourceMoleculeCounts?.explanation, 1);
  assert.ok(entry.chemistryIssues?.some((issue) => /did not complete/.test(issue)));
});

void test('a completeness retry cannot borrow an identical question label from a different printed section', async () => {
  const primary = { sections: [{ section_name: 'Exercise 1', solutions: { 'B-3': { answer: null, explanation: 'Original product drawing.', explanation_visual_kind: 'molecule' } } }] };
  const retry = { sections: [{ section_name: 'Exercise 2', solutions: { 'B-3': { answer: null, explanation: 'Different section product.', explanation_visual_kind: 'none' } } }] };
  const { vision, requests } = fixture([primary, { molecules: [], source_counts: [{ field_path: '/sections/0/solutions/B-3/explanation', observed_molecule_count: 1 }] }, retry]);
  const result = await vision.extractSolutions({ document: { ...document, kind: 'solution' }, pages: [{ pageNumber: 7, png: await png() }] });
  assert.equal(requests.length, 3);
  const sheet = result.sheets[0];
  assert.ok(sheet);
  const entry = sheet.entries['B-3'];
  assert.ok(entry);
  assert.equal(sheet.sectionName, 'Exercise 1');
  assert.equal(entry.explanation, 'Original product drawing.');
  assert.equal(entry.sourceMoleculeCounts?.explanation, 1);
  assert.ok(entry.chemistryIssues?.some((issue) => /changed printed answer\/solution ownership/.test(issue)));
});
