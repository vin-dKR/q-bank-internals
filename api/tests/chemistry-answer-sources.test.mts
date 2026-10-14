import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { chemistrySourceReviewIssues, DocumentSchema, QuestionSchema } from '@ingest/contracts';
import { attachChemistryAnswerSources, parsedAnswerSourceRegions } from '../src/infrastructure/ai/chemistry-answer-sources.js';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import { SharpImageCropper } from '../src/infrastructure/pdf/sharp-image-cropper.js';
import { ExtractionVisualsService } from '../src/modules/extraction/extraction-visuals.service.js';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import { mergeAnswerEntries } from '../src/modules/extraction/vision-extractor.js';
import { toNewQuestion } from '../src/modules/extraction/extraction.worker.js';
import type { AnswerEntry, ExtractedQuestion, PageImage, SourcePageLayout } from '../src/modules/extraction/index.js';

const document = DocumentSchema.parse({
  id: 'solution-doc', driveFileId: 'drive', fileName: 'solutions.pdf', path: { module: 'provider', chapter: 'Chemistry', section: 'exercise' },
  kind: 'solution', questionType: 'subjective', subject: 'Chemistry', status: 'uploaded', questionCount: 0,
  sessionId: null, sectionName: 'exercise', exam: null, pyq: false, pyqExam: null, pyqYear: null,
  paper: null, source: 'module', pageRange: null, topics: [], flagged: false, deletedAt: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), extractedAt: null,
});
const layout: SourcePageLayout = {
  source: 'native_pdf', width: 200, height: 300, contentBox: [0, 0, 1, 1], limitations: [],
  questions: [
    { printedLabel: 'A-1', sourceSection: 'exercise', anchorBox: [.05, .1, .1, .13], bbox: [.05, .1, .95, .4], stemBbox: null, options: [] },
    { printedLabel: 'A-2', sourceSection: 'exercise', anchorBox: [.05, .5, .1, .53], bbox: [.05, .5, .95, .9], stemBbox: null, options: [] },
  ],
};
const molecular = 'Reduction yields <smiles>Oc1ccccc1</smiles> at \\(25^\\circ\\mathrm{C}\\).';

async function page(pageNumber = 4): Promise<PageImage> {
  const png = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#fafafa' } }).png().toBuffer();
  return { pageNumber, png, layout };
}

function question(): ExtractedQuestion {
  return { questionNumber: 1, printedLabel: 'A-1', questionText: 'Identify the product.', options: ['(A) First', '(B) Second', '(C) Third'], answer: null, explanation: null, sectionName: 'exercise', questionType: 'single_correct', level: null, difficultyConfidence: null, sourcePage: 1, pyqExam: null, pyqYear: null, match: null, passage: null, passageId: null, groupOrder: null };
}

void test('native solution blocks preserve audit evidence through key merge while rendering the molecular transcription', async () => {
  const source = await page();
  const sheets = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: 'B', explanation: molecular, answerSource: 'solution' } } }], document, source);
  const names: string[] = [];
  const bytes: Buffer[] = [];
  const visuals = new ExtractionVisualsService({ upload: async (name, png) => { names.push(name); bytes.push(png); return `https://source.test/${String(bytes.length)}.png`; } }, new SharpImageCropper());
  const preserved = await visuals.preserveSheets(document.id, [source], sheets);
  const merged = mergeAnswers([question()], [...preserved, { sectionName: 'exercise', entries: { 'A-1': { answer: 'C', explanation: null, answerSource: 'answer_key' } } }], []);
  const draft = merged[0];
  assert.ok(draft?.chemistry);
  assert.equal(draft.answer, 'C');
  assert.equal(draft.chemistry.candidateExplanation, molecular);
  assert.deepEqual(draft.chemistry.visuals.map((visual) => [visual.field, visual.sourceDocumentId, visual.sourcePage]), [['explanation', document.id, 4]]);
  const row = toNewQuestion({ ...document, id: 'question-doc', kind: 'question', questionType: 'single_correct' }, draft, { model: 'test', at: new Date(0).toISOString() });
  assert.equal(row.answer, 'C');
  assert.equal(row.options[2]?.isCorrect, true);
  assert.equal(row.explanation, molecular);
  assert.deepEqual(row.explanationImages, []);
  assert.deepEqual(row.imageCrops, []);
  assert.equal(row.chemistry?.visuals[0]?.sourceDocumentId, document.id);
  assert.equal(row.chemistry.visuals[0].sourcePage, 4);
  assert.equal(row.chemistry.representation, 'transcription');
  assert.equal((await sharp(bytes[0]).metadata()).height, 90);
  assert.match(names[0] ?? '', /extraction\/solution-doc\/page-4-/);
});

void test('a drawn final answer renders SMILES and keeps its source crop only as audit evidence', async () => {
  const source = await page();
  const answer = '<smiles>Oc1ccccc1</smiles>';
  const sheets = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer, explanation: null } } }], document, source);
  const visuals = new ExtractionVisualsService({ upload: async () => 'https://source.test/answer.png' }, new SharpImageCropper());
  const merged = mergeAnswers([question()], await visuals.preserveSheets(document.id, [source], sheets), []);
  const draft = merged[0];
  assert.ok(draft?.chemistry);
  const row = toNewQuestion(document, draft, { model: 'test', at: new Date(0).toISOString() });
  assert.equal(row.chemistry?.candidateAnswer, answer);
  assert.deepEqual(row.answerImages, []);
  assert.equal(row.answer, answer);
  assert.deepEqual(row.imageCrops, []);
  assert.equal(row.chemistry.visuals[0]?.cropUrl, 'https://source.test/answer.png');
});

void test('multi-page solution continuations retain both source images while an explicit answer key replaces only the answer candidate', async () => {
  const first = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: '<smiles>CCO</smiles>', explanation: molecular, answerSource: 'solution' } } }], document, await page(4));
  const second = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: 'Then <smiles>CC=O</smiles>.', answerSource: 'solution' } } }], document, await page(5));
  const combined = mergeAnswerEntries(first[0]?.entries['A-1'], second[0]?.entries['A-1'] ?? { answer: null, explanation: null });
  const reconciled = mergeAnswerEntries(combined, { answer: 'A', explanation: null, answerSource: 'answer_key' });
  assert.equal(reconciled.answer, 'A');
  assert.match(reconciled.explanation ?? '', /Reduction yields/);
  assert.match(reconciled.explanation ?? '', /Then/);
  assert.deepEqual(reconciled.chemistryVisuals?.map((visual) => [visual.field, visual.sourcePage]), [['explanation', 4], ['explanation', 5]]);
});

function workedFragment(explanation: string, sourcePage: number): AnswerEntry {
  const id = `solution:${String(sourcePage)}:explanation`;
  const smiles = [...explanation.matchAll(/<smiles>([^<]+)<\/smiles>/g)].map((match) => match[1] ?? '');
  const url = `https://source.test/page-${String(sourcePage)}.png`;
  return {
    answer: null, explanation, answerSource: 'solution',
    chemistryVisuals: [{ id, field: 'explanation', optionLabel: null, kind: 'reaction', bbox: [.1, .1, .8, .3], candidateSmiles: smiles, graphValid: true, cropUrl: url, sourcePage, moleculeCount: smiles.length }],
    molecularAudits: smiles.map((canonicalSmiles, index) => ({ candidateId: `${id}/${String(index)}`, fieldPath: `/${id}/explanation`, status: 'matched', message: 'Source graph matches.', canonicalSmiles })),
    imageCrops: [{ url, type: 'solution', optionIndex: 0, nx: 20, ny: 30, nw: 160, nh: 90, sourcePage }],
    sourceVisualKinds: { explanation: 'reaction' },
  };
}

void test('duplicate and subset explanations retain only the surviving source molecule ledger', () => {
  const prior = workedFragment('First <smiles>CCO</smiles>. Then <smiles>CC=O</smiles>.', 4);
  for (const explanation of [prior.explanation ?? '', 'First <smiles>CCO</smiles>.']) {
    const incoming = { ...workedFragment(explanation, 5), unresolvedSourceFields: ['explanation' as const] };
    const merged = mergeAnswerEntries({ ...prior, answer: 'C', answerSource: 'answer_key' }, { ...incoming, answer: 'A' });
    assert.equal(merged.answer, 'C');
    assert.equal(merged.answerSource, 'answer_key');
    assert.equal(merged.explanation, prior.explanation);
    assert.deepEqual(merged.chemistryVisuals?.map((visual) => [visual.sourcePage, visual.moleculeCount]), [[4, 2]]);
    assert.deepEqual(merged.molecularAudits?.map((audit) => audit.canonicalSmiles), ['CCO', 'CC=O']);
    assert.deepEqual(merged.imageCrops?.map((crop) => crop.sourcePage), [4]);
    assert.equal(merged.unresolvedSourceFields, undefined);
  }
});

void test('a complete replacement explanation uses its own source ledger and preserves canonical answer priority', () => {
  const prior = { ...workedFragment('First <smiles>CCO</smiles>.', 4), answer: 'B', answerSource: 'answer_key' as const, unresolvedSourceFields: ['explanation' as const] };
  const incoming = { ...workedFragment('First <smiles>CCO</smiles>. Then <smiles>CC=O</smiles>.', 5), answer: 'A' };
  const merged = mergeAnswerEntries(prior, incoming);
  assert.equal(merged.answer, 'B');
  assert.equal(merged.explanation, incoming.explanation);
  assert.deepEqual(merged.chemistryVisuals?.map((visual) => [visual.sourcePage, visual.moleculeCount]), [[5, 2]]);
  assert.deepEqual(merged.molecularAudits?.map((audit) => audit.canonicalSmiles), ['CCO', 'CC=O']);
  assert.deepEqual(merged.imageCrops?.map((crop) => crop.sourcePage), [5]);
  assert.equal(merged.unresolvedSourceFields, undefined);
});

void test('genuine working continuations retain both ledgers in the same order as their molecular prose', () => {
  const prior = workedFragment('First <smiles>CCO</smiles>.', 4);
  const incoming = workedFragment('Then <smiles>CC=O</smiles>.', 5);
  const merged = mergeAnswerEntries(prior, incoming);
  assert.equal(merged.explanation, `${prior.explanation ?? ''}\n\n${incoming.explanation ?? ''}`);
  assert.deepEqual(merged.chemistryVisuals?.map((visual) => [visual.sourcePage, visual.moleculeCount]), [[4, 1], [5, 1]]);
  assert.deepEqual(merged.molecularAudits?.map((audit) => audit.canonicalSmiles), ['CCO', 'CC=O']);
  assert.deepEqual(merged.imageCrops?.map((crop) => crop.sourcePage), [4, 5]);
});

void test('a repeated complete solution remains reviewable after sheet merge and question finalization', () => {
  const complete = 'First <smiles>CCO</smiles>. Then <smiles>CC=O</smiles>.';
  const sheets = [4, 5].map((sourcePage) => ({ sectionName: 'exercise', entries: { 'A-1': workedFragment(complete, sourcePage) } }));
  const draft = mergeAnswers([question()], sheets, [])[0];
  assert.ok(draft);
  const row = toNewQuestion(document, draft, { model: 'test', at: new Date(0).toISOString() });
  const saved = QuestionSchema.parse({ ...row, id: 'question', flagged: false, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
  assert.equal(saved.explanation, complete);
  assert.equal(saved.chemistry?.visuals.length, 1);
  assert.deepEqual(chemistrySourceReviewIssues(saved), []);
});

void test('missing, foreign-label and overlapping fallback geometry remain explicit unresolved sources', async () => {
  const source = await page();
  const missing = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'B-1': { answer: null, explanation: molecular } } }], document, source);
  assert.equal(missing[0]?.entries['B-1']?.chemistryVisuals, undefined);
  assert.match(missing[0]?.entries['B-1']?.chemistryIssues?.[0] ?? '', /could not be assigned/);
  const foreign = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular, sourceRegions: [[.05, .1, .95, .4], [.05, .5, .95, .9]] } } }], document, source);
  assert.equal(foreign[0]?.entries['A-1']?.chemistryVisuals, undefined);
  const noLayout = { pageNumber: source.pageNumber, png: source.png };
  const overlapping = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: {
    'A-1': { answer: null, explanation: molecular, sourceRegions: [[.05, .1, .95, .6]] },
    'A-2': { answer: null, explanation: molecular, sourceRegions: [[.05, .5, .95, .9]] },
  } }], document, noLayout);
  assert.ok(Object.values(overlapping[0]?.entries ?? {}).every((entry) => entry.chemistryIssues?.length && !entry.chemistryVisuals));
  assert.deepEqual(parsedAnswerSourceRegions({ source_bbox: [50, 100, 950, 400] }), [[.05, .1, .95, .4]]);
  assert.deepEqual(parsedAnswerSourceRegions({ source_bbox: [950, 100, 50, 400] }), []);
  assert.deepEqual(parsedAnswerSourceRegions({ source_regions: [[50, 100, 950, 400], [0, 0, 1001, 900]] }), []);
});

void test('solution extraction accepts model source geometry on scanned pages and asks for complete numbered ownership', async () => {
  const requests: unknown[] = [];
  const replies = [
    { sections: [{ section_name: 'exercise', solutions: { 'A-1': { answer: null, explanation: molecular, source_bbox: [50, 100, 950, 400], source_regions: [] } } }] },
    { patches: [{ id: '/sections/0/solutions/A-1/explanation/smiles/0', smiles: 'Oc1ccccc1' }] },
  ];
  const extractor = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(extractor, { client: { chat: { completions: { create: async (request: unknown) => {
    requests.push(request);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(replies.shift()) } }] };
  } } } } });
  const source = await page();
  const result = await extractor.extractSolutions({ document, pages: [{ pageNumber: 4, png: source.png }] });
  assert.match(JSON.stringify(requests[0]), /COMPLETE printed numbered entry/);
  assert.equal(result.sheets[0]?.entries['A-1']?.chemistryVisuals?.[0]?.field, 'explanation');
  assert.deepEqual(result.sheets[0].entries['A-1'].chemistryVisuals[0].bbox.map((coordinate) => Number(coordinate.toFixed(3))), [.05, .1, .9, .3]);
});

void test('source preservation refuses a sibling document mismatch rather than uploading a crop from another source', async () => {
  const source = await page();
  const sheets = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular } } }], document, source);
  const visuals = new ExtractionVisualsService({ upload: async () => { throw new Error('No upload should occur'); } }, new SharpImageCropper());
  await assert.rejects(visuals.preserveSheets('another-doc', [source], sheets), /source page is unavailable/);
});

void test('a solution comparison upload outage retains the recognized answer and solution with a visible diagnostic', async () => {
  const source = await page();
  const answer = '<smiles>Oc1ccccc1</smiles>';
  const sheets = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer, explanation: molecular } } }], document, source);
  const visuals = new ExtractionVisualsService({ upload: async () => { throw new Error('Storage unavailable'); } }, new SharpImageCropper());
  const preserved = await visuals.preserveSheets(document.id, [source], sheets);
  const entry = preserved[0]?.entries['A-1'];
  assert.ok(entry);
  assert.equal(entry.answer, answer);
  assert.equal(entry.explanation, molecular);
  assert.ok(entry.chemistryIssues?.some((issue) => issue.includes('Comparison crop unavailable')));
  assert.ok(entry.chemistryVisuals?.every((visual) => visual.cropUrl === null && visual.sourceDocumentId === document.id && visual.sourcePage === source.pageNumber));
  assert.deepEqual(entry.imageCrops, []);
});

void test('unreadable source diagrams still receive authoritative images when no molecular candidate is emitted', async () => {
  const source = await page();
  const sheets = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: {
    'A-1': { answer: 'B', explanation: 'The diagram is not readable.', sourceVisualKinds: { explanation: 'molecule' } },
  } }], document, source);
  const visual = sheets[0]?.entries['A-1']?.chemistryVisuals?.[0];
  assert.ok(visual);
  assert.equal(visual.field, 'explanation');
  assert.deepEqual(visual.candidateSmiles, []);
  assert.equal(visual.graphValid, null);
});

void test('terminal-column solutions require explicit continuation parts while normally bounded blocks retain native ownership', async () => {
  const source = await page();
  const first = layout.questions[0];
  const second = layout.questions[1];
  assert.ok(first && second);
  const continued = { ...source, layout: {
    ...layout, limitations: ['column_continuations_require_multi_region_review'], questions: [
      { ...first, bbox: [.05, .6, .45, .95] as [number, number, number, number], anchorBox: [.05, .6, .1, .63] as [number, number, number, number] },
      { ...second, bbox: [.55, .4, .95, .9] as [number, number, number, number], anchorBox: [.55, .4, .6, .43] as [number, number, number, number] },
    ],
  } };
  const unresolved = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular } } }], document, continued);
  assert.equal(unresolved[0]?.entries['A-1']?.chemistryVisuals, undefined);
  const resolved = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular, sourceRegions: [[.05, .6, .45, .95], [.55, .05, .95, .35]] } } }], document, continued);
  assert.equal(resolved[0]?.entries['A-1']?.chemistryVisuals?.[0]?.regions?.length, 2);
  const reversed = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular, sourceRegions: [[.55, .05, .95, .35], [.05, .6, .45, .95]] } } }], document, continued);
  assert.deepEqual(reversed[0]?.entries['A-1']?.unresolvedSourceFields, ['explanation']);
  const bounded = { ...continued, layout: { ...continued.layout, questions: [...continued.layout.questions, { ...second, printedLabel: 'A-3' }] } };
  const sourceBeforeNext = { ...bounded, layout: { ...bounded.layout, questions: bounded.layout.questions.map((anchor) => anchor.printedLabel === 'A-3' ? { ...anchor, anchorBox: [.05, .8, .1, .83] as [number, number, number, number] } : anchor) } };
  const ordinary = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: molecular } } }], document, { ...sourceBeforeNext, layout: { ...sourceBeforeNext.layout, questions: sourceBeforeNext.layout.questions.map((anchor) => anchor.printedLabel === 'A-1' ? { ...anchor, bbox: [.05, .6, .45, .78] as [number, number, number, number] } : anchor) } });
  assert.equal(ordinary[0]?.entries['A-1']?.chemistryVisuals?.[0]?.field, 'explanation');
});

void test('inline molecular answers and working are preserved from their owned question source before finalization', async () => {
  const replies = [
    { page_role: 'questions', question_regions: [{ printed_label: 'A-1', source_section: 'exercise', bbox: [50, 100, 950, 900], source_regions: [], stem_bbox: [50, 100, 950, 900], stem_regions: [], visual_kind: 'none', options: [] }] },
    { questions: [{ question_number: 1, printed_label: 'A-1', question_text: 'Identify the printed product.', options: [], answer: '<smiles>CCO</smiles>', explanation: 'Product is <smiles>CCO</smiles>.' }] },
    { patches: [{ id: '/questions/0/answer/smiles/0', smiles: 'CCO' }, { id: '/questions/0/explanation/smiles/0', smiles: 'CCO' }] },
  ];
  const extractor = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(extractor, { client: { chat: { completions: { create: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(replies.shift()) } }] }) } } } });
  const source = await page();
  const questionDocument = { ...document, kind: 'question' as const, answerLayout: 'inline' as const };
  const extracted = await extractor.extractQuestions({ document: questionDocument, pages: [{ pageNumber: 4, png: source.png }] });
  assert.deepEqual(extracted.questions[0]?.chemistry?.visuals.map((visual) => visual.field), ['answer', 'explanation']);
  const visuals = new ExtractionVisualsService({ upload: async (name) => `https://source.test/${name}` }, new SharpImageCropper());
  const preserved = await visuals.preserve(document.id, { pageNumber: 4, png: source.png }, extracted.questions);
  const draft = preserved[0];
  assert.ok(draft);
  const row = toNewQuestion(questionDocument, draft, { model: 'test', at: new Date(0).toISOString() });
  assert.equal(row.stem, 'Identify the printed product.');
  assert.equal(row.answerImages.length, 0);
  assert.equal(row.explanationImages.length, 0);
  assert.equal(row.answer, '<smiles>CCO</smiles>');
  assert.match(row.explanation ?? '', /Product is/);
  assert.equal(row.explanation, 'Product is <smiles>CCO</smiles>.');
});

void test('a missing source continuation stays explicit while SMILES working remains visible', async () => {
  const source = await page();
  const initial = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: 'B', explanation: molecular, answerSource: 'solution' } } }], document, source);
  const visuals = new ExtractionVisualsService({ upload: async () => 'https://source.test/first.png' }, new SharpImageCropper());
  const first = await visuals.preserveSheets(document.id, [source], initial);
  const missing = await attachChemistryAnswerSources([{ sectionName: 'exercise', entries: { 'A-1': { answer: null, explanation: 'Then <smiles>CC=O</smiles>.', answerSource: 'solution' } } }], document, { pageNumber: 5, png: source.png });
  const draft = mergeAnswers([question()], [...first, ...missing], [])[0];
  assert.ok(draft);
  const row = toNewQuestion(document, draft, { model: 'test', at: new Date(0).toISOString() });
  const saved = QuestionSchema.parse({ ...row, id: 'question', flagged: false, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
  assert.deepEqual(saved.chemistry?.unresolvedSourceFields, ['explanation']);
  assert.equal(saved.explanationImages.length, 0);
  assert.ok(saved.chemistry.unresolvedSourceFields.includes('explanation'));
  assert.match(saved.explanation ?? '', /<smiles>/);
});

void test('a canonical answer key clears a failed solution answer-source stamp without dropping unresolved working', () => {
  const merged = mergeAnswerEntries({ answer: '<smiles>CCO</smiles>', explanation: molecular, answerSource: 'solution', unresolvedSourceFields: ['answer', 'explanation'] }, { answer: 'C', explanation: null, answerSource: 'answer_key' });
  assert.equal(merged.answer, 'C');
  assert.deepEqual(merged.unresolvedSourceFields, ['explanation']);
  const draft = mergeAnswers([question()], [{ sectionName: 'exercise', entries: { 'A-1': merged } }], [])[0];
  assert.ok(draft);
  assert.equal(draft.chemistry?.candidateAnswer, 'C');
  assert.deepEqual(draft.chemistry.unresolvedSourceFields, ['explanation']);
});

void test('ordinary subject solution extraction keeps its single page call and avoids chemistry localization instructions', async () => {
  const requests: unknown[] = [];
  const extractor = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(extractor, { client: { chat: { completions: { create: async (request: unknown) => {
    requests.push(request);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sections: [{ section_name: 'exercise', solutions: { 'A-1': { answer: 2, explanation: 'Subtract one from three.' } } }] }) } }] };
  } } } } });
  const mathDocument = { ...document, subject: 'Mathematics', path: { ...document.path, chapter: 'Algebra' } };
  const result = await extractor.extractSolutions({ document: mathDocument, pages: [await page()] });
  assert.equal(result.usage.callCount, 1);
  assert.equal(result.sheets[0]?.entries['A-1']?.answer, '2');
  assert.doesNotMatch(JSON.stringify(requests[0]), /CHEMISTRY SOURCE OWNERSHIP/);
  assert.equal(result.sheets[0].entries['A-1'].chemistryVisuals, undefined);
});
