import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { ChemistryExtractionSchema, type ChemistryExtraction } from '@ingest/contracts';
import { SharpImageCropper } from '../src/infrastructure/pdf/sharp-image-cropper.js';
import { ExtractionVisualsService } from '../src/modules/extraction/extraction-visuals.service.js';
import type { ExtractedQuestion } from '../src/modules/extraction/index.js';

const PARTS: Array<[number, number, number, number]> = [[0.05, 0.7, 0.4, 0.2], [0.6, 0.05, 0.3, 0.3]];

async function sourcePage(): Promise<Buffer> {
  const width = 200;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const set = (x: number, y: number, color: [number, number, number, number]): void => {
    pixels.set(color, (y * width + x) * 4);
  };
  for (let y = 140; y < 180; y += 1) {
    for (let x = 10; x < 90; x += 1) {
      set(x, y, x === 10 || x === 89 || y === 140 || y === 179 ? [0, 0, 0, 255] : [240, 50, 40, 255]);
    }
  }
  for (let y = 10; y < 70; y += 1) {
    for (let x = 120; x < 180; x += 1) {
      set(x, y, x === 120 || x === 179 || y === 10 || y === 69 ? [0, 0, 0, 255] : [20, 90, 230, 255]);
    }
  }
  set(15, 145, [123, 45, 67, 120]);
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rgba(png: Buffer): Promise<Buffer> {
  return sharp(png).toColourspace('srgb').ensureAlpha().raw().toBuffer();
}

function metadata(): ChemistryExtraction {
  return {
    version: 1, status: 'needs_review', issues: [], candidateStem: 'Question starts at left bottom and continues at right top.', candidateOptions: [],
    visuals: [{ id: 'stem:source', field: 'stem', optionLabel: null, kind: 'reaction', bbox: PARTS[0] ?? [0, 0, 1, 1], regions: PARTS, candidateSmiles: [], graphValid: null, cropUrl: null }],
  };
}

function question(chemistry: ChemistryExtraction): ExtractedQuestion {
  return {
    questionNumber: 5, printedLabel: '5', chemistry, questionText: 'Question starts at left bottom and continues at right top.', options: [],
    answer: null, explanation: null, sectionName: 'Exercise', questionType: 'subjective', level: null,
    difficultyConfidence: null, sourcePage: 1, pyqExam: null, pyqYear: null,
    match: null, passage: null, passageId: null, groupOrder: null,
  };
}

void test('column continuation preserves complete native pixels in supplied reading order with an opaque white gap', async () => {
  const source = await sourcePage();
  const original = Buffer.from(source);
  const cropper = new SharpImageCropper();
  const composed = await cropper.compose(source, PARTS);
  const dimensions = await sharp(composed).metadata();
  assert.equal(dimensions.width, 80);
  assert.equal(dimensions.height, 112);
  const firstSource = await sharp(source).extract({ left: 10, top: 140, width: 80, height: 40 }).png().toBuffer();
  const firstComposed = await sharp(composed).extract({ left: 0, top: 0, width: 80, height: 40 }).png().toBuffer();
  const secondSource = await sharp(source).extract({ left: 120, top: 10, width: 60, height: 60 }).png().toBuffer();
  const secondComposed = await sharp(composed).extract({ left: 0, top: 52, width: 60, height: 60 }).png().toBuffer();
  assert.deepEqual(await rgba(firstComposed), await rgba(firstSource));
  assert.deepEqual(await rgba(secondComposed), await rgba(secondSource));
  const gap = await sharp(composed).extract({ left: 0, top: 40, width: 80, height: 12 }).ensureAlpha().raw().toBuffer();
  assert.ok(gap.every((channel) => channel === 255));
  const rightPadding = await sharp(composed).extract({ left: 60, top: 52, width: 20, height: 60 }).ensureAlpha().raw().toBuffer();
  assert.ok(rightPadding.every((channel) => channel === 255));
  assert.deepEqual(source, original);
});

void test('single-region composition retains the existing crop result and invalid regions never produce an image', async () => {
  const source = await sourcePage();
  const cropper = new SharpImageCropper();
  const first = PARTS[0];
  assert.ok(first);
  assert.deepEqual(await cropper.compose(source, [first]), await cropper.crop(source, first));
  await assert.rejects(cropper.compose(source, []), /at least one source region/);
  await assert.rejects(cropper.compose(source, [first, [0.9, 0.1, 0.2, 0.2]]), /invalid page coordinates/);
});

void test('preservation uploads one field image and retains every physical source rectangle under the shared URL', async () => {
  const source = await sourcePage();
  const uploads: Buffer[] = [];
  const service = new ExtractionVisualsService({ upload: async (_name, bytes) => { uploads.push(bytes); return 'https://images.example/composed.png'; } }, new SharpImageCropper());
  const saved = await service.preserve('doc', { pageNumber: 1, png: source }, [question(metadata())]);
  const row = saved[0];
  assert.ok(row?.chemistry);
  assert.equal(uploads.length, 1);
  assert.equal(row.chemistry.visuals[0]?.cropUrl, 'https://images.example/composed.png');
  assert.deepEqual(row.chemistry.visuals[0].regions, PARTS);
  assert.equal(row.chemistry.status, 'needs_review');
  assert.deepEqual(row.imageCrops?.map((crop) => [crop.url, crop.type, crop.optionIndex, crop.nx, crop.ny, crop.nw, crop.nh, crop.sourcePage]), [
    ['https://images.example/composed.png', 'question', 0, 10, 140, 80, 40, 1],
    ['https://images.example/composed.png', 'question', 0, 120, 10, 60, 60, 1],
  ]);
  assert.deepEqual(await rgba(uploads[0] ?? Buffer.alloc(0)), await rgba(await new SharpImageCropper().compose(source, PARTS)));
});

void test('optional source regions preserve legacy metadata and validate every physical rectangle', () => {
  const chemistry = metadata();
  const first = chemistry.visuals[0];
  assert.ok(first);
  const legacyVisual = Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'regions'));
  const legacy = ChemistryExtractionSchema.parse({ ...chemistry, visuals: [legacyVisual] });
  assert.equal(Object.hasOwn(legacy.visuals[0] ?? {}, 'regions'), false);
  assert.equal(ChemistryExtractionSchema.safeParse(chemistry).success, true);
  assert.equal(ChemistryExtractionSchema.safeParse({ ...chemistry, visuals: [{ ...first, regions: [] }] }).success, false);
  assert.equal(ChemistryExtractionSchema.safeParse({ ...chemistry, visuals: [{ ...first, regions: [[0.9, 0.1, 0.2, 0.2]] }] }).success, false);
});
