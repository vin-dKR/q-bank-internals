import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { DocumentSchema } from '@ingest/contracts';
import { parseChemistryInventory, type ChemistryBox, type ChemistryQuestionRegion } from '../src/infrastructure/ai/chemistry-page-inventory.js';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';

function region(label: string | null, bbox: ChemistryBox, section: string | null = 'Section B'): ChemistryQuestionRegion {
  return { printed_label: label, source_section: section, bbox, source_regions: [], stem_bbox: null, stem_regions: [], visual_kind: 'none', options: [] };
}

function parse(regions: ChemistryQuestionRegion[]): ReturnType<typeof parseChemistryInventory> {
  return parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: regions }));
}

void test('overlapping question crops cannot copy adjacent source questions into different identities', () => {
  assert.throws(() => parse([
    region('B-2', [80, 116, 950, 408]),
    region('B-3', [80, 277, 950, 544]),
  ]), /B-2 and B-3 overlap significantly/);
  assert.throws(() => parse([
    region(null, [100, 100, 900, 500]),
    region(null, [200, 150, 800, 400]),
  ]), /source ownership is ambiguous/);
});

void test('disjoint adjacent columns and source questions separated vertically keep their ownership', () => {
  assert.equal(parse([
    region('B-1', [50, 100, 480, 400]),
    region('B-2', [520, 100, 950, 400]),
    region('B-3', [50, 420, 480, 700]),
    region('B-4', [520, 420, 950, 700]),
  ]).question_regions.length, 4);
});

void test('two-unit edge padding and small intersections remain allowed at explicit geometry limits', () => {
  assert.equal(parse([
    region('B-1', [100, 100, 900, 300]),
    region('B-2', [100, 298, 900, 550]),
  ]).question_regions.length, 2);
  assert.equal(parse([
    region('B-1', [100, 100, 900, 300]),
    region('B-2', [100, 291, 900, 500]),
  ]).question_regions.length, 2);
  assert.equal(parse([
    region('B-1', [50, 100, 500, 400]),
    region('B-2', [498, 100, 950, 400]),
  ]).question_regions.length, 2);
  assert.throws(() => parse([
    region('B-1', [100, 100, 900, 300]),
    region('B-2', [100, 290, 900, 500]),
  ]), /overlap significantly/);
});

void test('printed identifiers normalize typography and cannot duplicate within the same printed scope', () => {
  assert.throws(() => parse([
    region('B-3', [100, 100, 900, 200], 'Section B'),
    region('(b – 03)', [100, 300, 900, 400], '  SECTION   B  '),
  ]), /repeated question label B-3/);
  assert.throws(() => parse([
    region('Q. 3', [100, 100, 900, 200], null),
    region('3', [100, 300, 900, 400], 'Section B'),
  ]), /without a distinct printed section/);
});

void test('explicit printed section restarts and unknown null labels are retained without inventing identity', () => {
  const parsed = parse([
    region('3', [100, 100, 900, 200], 'Exercise I'),
    region('3', [100, 300, 900, 400], 'Exercise II'),
    region(null, [100, 500, 900, 600], null),
    region(null, [100, 700, 900, 800], null),
  ]);
  assert.deepEqual(parsed.question_regions.map((question) => question.printed_label), ['3', '3', null, null]);
});

void test('ambiguous source ownership stops before any paid question transcription request', async () => {
  const document = DocumentSchema.parse({
    id: 'doc', driveFileId: 'drive', fileName: 'paper.pdf', path: { module: 'provider', chapter: 'Chemistry', section: 'exercise' },
    kind: 'question', questionType: 'single_correct', subject: 'Chemistry', status: 'uploaded', questionCount: 0,
    sessionId: null, sectionName: 'exercise', exam: null, pyq: false, pyqExam: null, pyqYear: null,
    paper: null, source: 'module', pageRange: null, topics: [], flagged: false, deletedAt: null,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), extractedAt: null,
  });
  const inventory = { page_role: 'questions', question_regions: [
    region('B-2', [80, 116, 950, 408]), region('B-3', [80, 277, 950, 544]),
  ] };
  let requests = 0;
  const vision = new OpenAiVisionExtractor('test', 'model', async () => ({}), async () => ({ questionType: [], level: [] }));
  Object.assign(vision, { client: { chat: { completions: { create: async () => {
    requests += 1;
    return {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(inventory) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  } } } } });
  const png = await sharp({ create: { width: 200, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(vision.extractQuestions({ pages: [{ pageNumber: 9, png }], document }), /source ownership is ambiguous/);
  assert.equal(requests, 1);
});
