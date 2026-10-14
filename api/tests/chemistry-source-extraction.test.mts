import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { DocumentSchema } from '@ingest/contracts';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import { ExtractionVisualsService } from '../src/modules/extraction/extraction-visuals.service.js';
import { SharpImageCropper } from '../src/infrastructure/pdf/sharp-image-cropper.js';
import { toNewQuestion } from '../src/modules/extraction/extraction.worker.js';
import { parseChemistryInventory } from '../src/infrastructure/ai/chemistry-page-inventory.js';
import type { ExtractedQuestion, SourcePageLayout } from '../src/modules/extraction/index.js';

const document = DocumentSchema.parse({
  id: 'doc', driveFileId: 'drive', fileName: 'paper.pdf', path: { module: 'provider', chapter: 'Chemistry', section: 'exercise' },
  kind: 'question', questionType: 'single_correct', subject: 'Chemistry', status: 'uploaded', questionCount: 0,
  sessionId: null, sectionName: 'exercise', exam: null, pyq: false, pyqExam: null, pyqYear: null,
  paper: null, source: 'module', pageRange: null, topics: [], flagged: false, deletedAt: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), extractedAt: null,
});
const region = {
  printed_label: 'B-3', source_section: 'Nitrogen compounds', bbox: [50, 100, 950, 900],
  stem_bbox: [50, 100, 950, 450], visual_kind: 'reaction',
  options: [
    { label: 'A', bbox: [50, 500, 450, 850], visual_kind: 'molecule' },
    { label: 'B', bbox: [500, 500, 950, 850], visual_kind: 'molecule' },
  ],
};
function extractor(replies: unknown[]): OpenAiVisionExtractor {
  const result = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(result, { client: { chat: { completions: { create: async () => {
    const response = replies.shift();
    if (response === undefined) throw new Error('Unexpected AI call');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  } } } } });
  return result;
}
async function image(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
}

void test('final question fields retain every molecular SMILES and reaction condition without automatic image fallback', () => {
  const stem = String.raw`Find the product: <smiles>Oc1ccccc1</smiles> \(\ce{->[HBr][\Delta]}\)`;
  const answer = '<smiles>Brc1ccccc1</smiles>';
  const explanation = 'The product remains <smiles>Brc1ccccc1</smiles>.';
  const urls = ['https://source.test/stem.png', 'https://source.test/option.png', 'https://source.test/answer.png', 'https://source.test/solution.png'];
  const draft: ExtractedQuestion = {
    questionNumber: 1, printedLabel: 'A-1', questionText: stem, options: ['(A) <smiles>Brc1ccccc1</smiles>'], answer, explanation,
    sectionName: 'exercise', questionType: 'subjective', level: null, difficultyConfidence: null, sourcePage: 1,
    pyqExam: null, pyqYear: null, match: null, passage: null, passageId: null, groupOrder: null,
    chemistry: {
      version: 1, status: 'needs_review', issues: [], candidateStem: stem, candidateOptions: ['(A) <smiles>Brc1ccccc1</smiles>'], candidateAnswer: answer, candidateExplanation: explanation,
      visuals: (['stem', 'option', 'answer', 'explanation'] as const).map((field, index) => ({ id: field, field, optionLabel: field === 'option' ? 'A' : null, kind: 'molecule', bbox: [0, 0, 0.2, 0.2], candidateSmiles: [field === 'stem' ? 'Oc1ccccc1' : 'Brc1ccccc1'], graphValid: true, cropUrl: urls[index] ?? '' })),
    },
    imageCrops: urls.map((url) => ({ url, type: 'question', optionIndex: 0, nx: 0, ny: 0, nw: 10, nh: 10 })),
  };
  const row = toNewQuestion({ ...document, questionType: 'subjective' }, draft, { model: 'test', at: new Date(0).toISOString() });
  assert.equal(row.stem, stem);
  assert.equal(row.options[0]?.body, '<smiles>Brc1ccccc1</smiles>');
  assert.equal(row.answer, answer);
  assert.equal(row.explanation, explanation);
  assert.equal(row.questionImage, null);
  assert.deepEqual([row.optionImages, row.answerImages, row.explanationImages, row.imageCrops], [[], [], [], []]);
  assert.equal(row.chemistry?.visuals.length, 4);
  assert.equal(row.chemistry.representation, 'transcription');
});

void test('diagram inventory retains source comparison evidence without projecting missing recognition into cropped question output', async () => {
  const png = await image();
  const vision = extractor([
    { page_role: 'questions', question_regions: [region] },
    { questions: [{ question_number: 3, question_text: 'Product?', options: ['(A) unreadable', '(B) unreadable'], question_type: 'single_correct' }] },
  ]);
  const result = await vision.extractQuestions({ pages: [{ pageNumber: 9, png }], document });
  assert.equal(result.questions.length, 1);
  const first = result.questions[0];
  assert.ok(first);
  assert.ok(first.chemistry);
  assert.equal(first.printedLabel, 'B-3');
  assert.equal(first.chemistry.visuals.length, 3);
  const uploads: Buffer[] = [];
  const service = new ExtractionVisualsService({ upload: async (_name, bytes) => { uploads.push(bytes); return `https://images.example/${String(uploads.length)}.png`; } }, new SharpImageCropper());
  const preserved = await service.preserve(document.id, { pageNumber: 9, png }, result.questions);
  const draft = preserved[0];
  assert.ok(draft);
  const row = toNewQuestion(document, draft, { model: 'model', at: new Date(0).toISOString() });
  assert.equal(row.stem, 'Product?');
  assert.equal(row.questionImage, null);
  assert.equal(row.isQuestionImage, false);
  assert.deepEqual(row.options.map((option) => option.body), ['unreadable', 'unreadable']);
  assert.deepEqual(row.optionImages, []);
  assert.equal(row.isOptionImage, false);
  assert.ok(row.chemistry);
  assert.equal(row.chemistry.candidateStem, 'Product?');
  assert.equal(row.chemistry.status, 'needs_review');
  assert.equal(row.chemistry.representation, 'transcription');
  assert.deepEqual(row.chemistry.visuals.map((visual) => visual.cropUrl), ['https://images.example/1.png', 'https://images.example/2.png', 'https://images.example/3.png']);
  assert.deepEqual(row.sourceRegion.bbox, [.05, .1, .95, .9]);
  assert.deepEqual(row.imageCrops, []);
  assert.equal((await sharp(uploads[0]).metadata()).width, 180);
});

void test('answer-only pages generate scoped answer sheets and zero question records', async () => {
  const vision = extractor([
    { page_role: 'answers', question_regions: [] },
    { sections: [{ section_name: 'exercise', solutions: { 'A-1': { answer: 'D', explanation: null }, 'B-1': { answer: 'A', explanation: null } } }] },
  ]);
  const result = await vision.extractQuestions({ pages: [{ pageNumber: 54, png: await image() }], document });
  assert.equal(result.questions.length, 0);
  assert.deepEqual(Object.keys(result.sheets?.[0]?.entries ?? {}), ['A-1', 'B-1']);
});

void test('local recognition cannot reorder or drop inventoried options', async () => {
  const vision = extractor([
    { page_role: 'questions', question_regions: [region] },
    { questions: [{ question_number: 3, question_text: 'Product?', options: ['(B) first', '(A) second'] }] },
  ]);
  await assert.rejects(vision.extractQuestions({ pages: [{ pageNumber: 9, png: await image() }], document }), /labels, order or count/);
});

void test('malformed source ownership fails rather than silently cropping another question', () => {
  assert.throws(() => parseChemistryInventory(JSON.stringify({ page_role: 'answers', question_regions: [region] })), /incorrectly inventoried/);
  assert.throws(() => parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: [] })), /omitted/);
  assert.throws(() => parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: [{ ...region, stem_bbox: [0, 0, 1000, 1000] }] })), /outside/);
});

void test('missing optional comparison uploads cannot suppress a completed SMILES transcription', async () => {
  const vision = extractor([
    { page_role: 'questions', question_regions: [region] },
    { questions: [{ question_number: 3, question_text: 'Product?', options: ['(A) first', '(B) second'] }] },
  ]);
  const result = await vision.extractQuestions({ pages: [{ pageNumber: 9, png: await image() }], document });
  const draft = result.questions[0];
  assert.ok(draft);
  draft.questionText = 'Use <smiles>c1ccccc1</smiles>';
  const row = toNewQuestion(document, draft, { model: 'model', at: new Date(0).toISOString() });
  assert.equal(row.stem, 'Use <smiles>c1ccccc1</smiles>');
  assert.equal(row.questionImage, null);
  assert.equal(row.chemistry?.visuals[0]?.cropUrl, null);
});

void test('visible native anchors replace drifting model crops and retain exact option ownership', () => {
  const layout: SourcePageLayout = {
    source: 'native_pdf', width: 200, height: 300, contentBox: [0, 0, 1, 1], limitations: [],
    questions: [{ printedLabel: 'B-3', sourceSection: null, anchorBox: [.05, .1, .1, .15], bbox: [.05, .1, .95, .9], stemBbox: [.05, .1, .95, .45], options: [
      { label: 'A', anchorBox: [.05, .5, .1, .55], bbox: [.05, .5, .45, .85] },
      { label: 'B', anchorBox: [.5, .5, .55, .55], bbox: [.5, .5, .95, .85] },
    ] }],
  };
  const inventory = parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: [{ ...region, bbox: [0, 0, 0, 0], stem_bbox: [0, 0, 0, 0], options: region.options.map((option) => ({ ...option, bbox: [0, 0, 0, 0] })) }] }), layout);
  assert.deepEqual(inventory.question_regions[0]?.bbox, region.bbox);
  assert.deepEqual(inventory.question_regions[0].options[1]?.bbox, region.options[1]?.bbox);
  assert.throws(() => parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: [{ ...region, printed_label: 'B-4' }] }), layout), /unique visible/);
});

void test('localized recognition cannot accept an empty reply or stamp a source identity onto an anonymous draft', async () => {
  for (const questions of [
    [],
    [{ question_text: 'Product?', options: ['(A) first', '(B) second'] }],
    [{ printed_label: null, question_number: null, question_text: 'Product?', options: ['(A) first', '(B) second'] }],
    [{ printed_label: 'unreadable', question_text: 'Product?', options: ['(A) first', '(B) second'] }],
  ]) {
    const vision = extractor([
      { page_role: 'questions', question_regions: [region] },
      { questions },
    ]);
    await assert.rejects(vision.extractQuestions({ pages: [{ pageNumber: 9, png: await image() }], document }), /missing or merged question|missing or different printed question identity/);
  }
});

void test('legacy numeric-only localized replies retain the independently observed full printed label', async () => {
  const vision = extractor([
    { page_role: 'questions', question_regions: [region] },
    { questions: [{ question_number: 3, question_text: 'Product?', options: ['(A) first', '(B) second'] }] },
  ]);
  const result = await vision.extractQuestions({ pages: [{ pageNumber: 9, png: await image() }], document });
  const question = result.questions[0];
  assert.ok(question);
  assert.equal(question.printedLabel, 'B-3');
  assert.equal(question.questionNumber, 3);
});

void test('explicit prefix disagreement and numeric ordinal disagreement cannot inherit inventoried ownership', async () => {
  for (const identity of [{ printed_label: 'A-3', question_number: 3 }, { question_number: 4 }]) {
    const vision = extractor([
      { page_role: 'questions', question_regions: [region] },
      { questions: [{ ...identity, question_text: 'Product?', options: ['(A) first', '(B) second'] }] },
    ]);
    await assert.rejects(vision.extractQuestions({ pages: [{ pageNumber: 9, png: await image() }], document }), /different printed question identity/);
  }
});
