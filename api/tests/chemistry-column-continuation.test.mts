import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  chemistryQuestionRegions, chemistryStemRegions, cropChemistryRegions, parseChemistryInventory,
  type ChemistryBox, type ChemistryQuestionRegion,
} from '../src/infrastructure/ai/chemistry-page-inventory.js';
import type { SourcePageLayout } from '../src/modules/extraction/index.js';

const QUESTION_PARTS: ChemistryBox[] = [[50, 700, 450, 900], [600, 50, 900, 350]];
const STEM_PARTS: ChemistryBox[] = [[50, 700, 450, 900], [600, 50, 900, 200]];

function ordinary(label: string, bbox: ChemistryBox, section = 'Exercise'): ChemistryQuestionRegion {
  return { printed_label: label, source_section: section, bbox, source_regions: [], stem_bbox: bbox, stem_regions: [], visual_kind: 'none', options: [] };
}

function continued(): ChemistryQuestionRegion {
  return {
    ...ordinary('5', [50, 50, 900, 900]),
    source_regions: QUESTION_PARTS,
    stem_regions: STEM_PARTS,
    visual_kind: 'reaction',
    options: [
      { label: '1', bbox: [600, 220, 740, 350], visual_kind: 'none' },
      { label: '2', bbox: [750, 220, 900, 350], visual_kind: 'none' },
    ],
  };
}

function pageInventory(question = continued()): ChemistryQuestionRegion[] {
  return [ordinary('4', [50, 100, 450, 650]), question, ordinary('6', [600, 400, 900, 700])];
}

function layout(): SourcePageLayout {
  return {
    source: 'native_pdf', width: 1000, height: 1000, contentBox: [0, 0, 1, 1],
    limitations: ['column_continuations_require_multi_region_review'],
    questions: [
      { printedLabel: '4', sourceSection: 'Exercise', anchorBox: [0.06, 0.12, 0.09, 0.14], bbox: [0.05, 0.1, 0.45, 0.65], stemBbox: null, options: [] },
      { printedLabel: '5', sourceSection: 'Exercise', anchorBox: [0.06, 0.72, 0.09, 0.74], bbox: [0.05, 0.7, 0.45, 0.9], stemBbox: null, options: [] },
      { printedLabel: '6', sourceSection: 'Exercise', anchorBox: [0.61, 0.42, 0.64, 0.44], bbox: [0.6, 0.4, 0.9, 0.7], stemBbox: null, options: [] },
    ],
  };
}

function parse(regions: ChemistryQuestionRegion[], sourceLayout?: SourcePageLayout): ReturnType<typeof parseChemistryInventory> {
  return parseChemistryInventory(JSON.stringify({ page_role: 'questions', question_regions: regions }), sourceLayout);
}

void test('two-column question ownership uses physical parts while its enclosing bounds can span neighboring questions', () => {
  const parsed = parse(pageInventory(), layout());
  const question = parsed.question_regions[1];
  assert.ok(question);
  assert.deepEqual(question.bbox, [50, 50, 900, 900]);
  assert.deepEqual(chemistryQuestionRegions(question), QUESTION_PARTS);
  assert.deepEqual(chemistryStemRegions(question), STEM_PARTS);
  assert.deepEqual(question.options.map((option) => option.label), ['1', '2']);
  assert.equal(parsed.question_regions.length, 3);
});

void test('duplicated and overlapping parts within one question or stem are not accepted as complete source content', () => {
  const duplicateSource = structuredClone(continued());
  duplicateSource.source_regions = [[50, 700, 450, 900], [50, 700, 450, 900]];
  duplicateSource.stem_regions = [[50, 700, 450, 900]];
  duplicateSource.options = [];
  assert.throws(() => parse([duplicateSource]), /question repeats or significantly overlaps/);
  const duplicateStem = structuredClone(continued());
  duplicateStem.stem_regions = [[50, 700, 450, 900], [50, 710, 450, 890]];
  assert.throws(() => parse([duplicateStem]), /stem repeats or significantly overlaps/);
});

void test('continued source parts must start at the native question label and retain stem reading order', () => {
  const reversedSource = structuredClone(continued());
  reversedSource.source_regions.reverse();
  reversedSource.stem_regions.reverse();
  assert.throws(() => parse(pageInventory(reversedSource), layout()), /first part.*visible native label/);
  const reversedStem = structuredClone(continued());
  reversedStem.stem_regions.reverse();
  assert.throws(() => parse(pageInventory(reversedStem)), /changed the reading order/);
});

void test('continuation rectangles cannot capture another question label or overlap another question ownership', () => {
  const contaminated = structuredClone(continued());
  contaminated.source_regions[1] = [600, 50, 900, 500];
  assert.throws(() => parse(pageInventory(contaminated), layout()), /another visible source question label/);
  assert.throws(() => parse(pageInventory(contaminated)), /5 and 6 overlap significantly/);
  const unownedStem = structuredClone(continued());
  unownedStem.stem_regions = [[50, 700, 900, 900]];
  assert.throws(() => parse(pageInventory(unownedStem)), /outside its question region/);
});

void test('native restarted identifiers require distinct printed sections and complete anchor coverage', () => {
  const sourceLayout = layout();
  const first = sourceLayout.questions[0];
  const second = sourceLayout.questions[2];
  assert.ok(first && second);
  sourceLayout.questions = [
    { ...first, printedLabel: '3', sourceSection: 'Exercise I' },
    { ...second, printedLabel: '3', sourceSection: 'Exercise II' },
  ];
  const firstRegion = ordinary('3', [50, 100, 450, 650], '  EXERCISE  I  ');
  const secondRegion = ordinary('Q. 3', [600, 400, 900, 700], 'Exercise II');
  assert.equal(parse([firstRegion, secondRegion], sourceLayout).question_regions.length, 2);
  assert.throws(() => parse([firstRegion], sourceLayout), /omitted a visible native question anchor/);
});

void test('recognition composition includes the exact left-bottom then right-top source pixels and no interleaved question content', async () => {
  const width = 200;
  const height = 200;
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = x >= 10 && x < 90 && y >= 140 && y < 180 ? [230, 30, 20, 255]
        : x >= 120 && x < 180 && y >= 10 && y < 70 ? [20, 40, 230, 255] : [0, 200, 50, 255];
      pixels.set(color, (y * width + x) * 4);
    }
  }
  const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const question = parse(pageInventory()).question_regions[1];
  assert.ok(question);
  const composed = await cropChemistryRegions(source, chemistryQuestionRegions(question));
  const dimensions = await sharp(composed).metadata();
  assert.equal(dimensions.width, 80);
  assert.equal(dimensions.height, 112);
  const first = await sharp(composed).extract({ left: 0, top: 0, width: 80, height: 40 }).ensureAlpha().raw().toBuffer();
  const firstSource = await sharp(source).extract({ left: 10, top: 140, width: 80, height: 40 }).ensureAlpha().raw().toBuffer();
  const second = await sharp(composed).extract({ left: 0, top: 52, width: 60, height: 60 }).ensureAlpha().raw().toBuffer();
  const secondSource = await sharp(source).extract({ left: 120, top: 10, width: 60, height: 60 }).ensureAlpha().raw().toBuffer();
  assert.deepEqual(first, firstSource);
  assert.deepEqual(second, secondSource);
  const stem = await cropChemistryRegions(source, chemistryStemRegions(question));
  assert.equal((await sharp(stem).metadata()).height, 82);
});
