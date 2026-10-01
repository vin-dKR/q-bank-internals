import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyMetadata } from '../src/features/ingestion/types/chapter-group.js';
import {
  nodesFromConfig,
  parseConfig,
  serializeConfig,
} from '../src/features/ingestion/lib/structure-config.js';
import {
  cropBounds,
  moveCropBounds,
  movedStructureCrop,
  orderStructureCrops,
  reviewedStructureText,
  reviewedStructureCropResults,
  StructureCropDraftSchema,
  type StructureCropDraftItem,
} from '../src/features/ingestion/lib/structure-crops.js';

void test('AI results require matching OCR and reviewed context; moving a crop discards them', () => {
  const item = crop('a', 1, 0, 0);
  item.ai = {
    contextKey: 'resonance',
    warnings: [],
    result: {
      cropId: 'a',
      text: item.text,
      contextKey: 'server-context-and-rules',
      items: [
        { section: null, part: { printed: 'PART I', label: 'I' }, topic: null, questionType: null },
      ],
    },
  };
  assert.equal(reviewedStructureCropResults([item], 'resonance').length, 1);
  assert.equal(reviewedStructureCropResults([item], 'allen').length, 0);
  assert.equal(
    reviewedStructureCropResults([{ ...item, reviewedText: null }], 'resonance').length,
    0,
  );
  assert.equal(reviewedStructureCropResults([{ ...item, text: 'PART II' }], 'resonance').length, 0);
  assert.equal(movedStructureCrop(item, { ...item.bounds, y0: 0.2 }).ai, null);
  assert.equal(
    StructureCropDraftSchema.safeParse({
      version: 1,
      fingerprint: 'x',
      ordered: true,
      crops: [item],
    }).success,
    true,
  );
});

void test('horizontal click selects a top band; drag selects a band independently of drag direction', () => {
  assert.deepEqual(cropBounds('horizontal', { x: 0.3, y: 0.25 }, { x: 0.3, y: 0.25 }), {
    x0: 0,
    x1: 1,
    y0: 0,
    y1: 0.25,
  });
  assert.deepEqual(cropBounds('horizontal', { x: 0.8, y: 0.6 }, { x: 0.2, y: 0.3 }), {
    x0: 0,
    x1: 1,
    y0: 0.3,
    y1: 0.6,
  });
});
void test('rectangle normalizes corners and clips to page; accidental clicks make no crop', () => {
  assert.deepEqual(cropBounds('rectangle', { x: 0.8, y: 0.6 }, { x: -0.1, y: 0.3 }), {
    x0: 0,
    x1: 0.8,
    y0: 0.3,
    y1: 0.6,
  });
  assert.equal(cropBounds('rectangle', { x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }), null);
});
void test('moving rectangles clamps translation at page edges without changing their size', () => {
  const box = { x0: 0.25, x1: 0.5, y0: 0.25, y1: 0.5 };
  assert.deepEqual(moveCropBounds(box, { x: -2, y: 3 }), {
    x0: 0,
    x1: 0.25,
    y0: 0.75,
    y1: 1,
  });
  assert.deepEqual(moveCropBounds(box, { x: 3, y: -2 }), {
    x0: 0.75,
    x1: 1,
    y0: 0,
    y1: 0.25,
  });
  assert.deepEqual(moveCropBounds(box, { x: 0, y: 0 }), box);
});
void test('horizontal bands move vertically and retain full page width', () => {
  assert.deepEqual(moveCropBounds({ x0: 0, x1: 1, y0: 0.25, y1: 0.5 }, { x: 0.3, y: 0.25 }), {
    x0: 0,
    x1: 1,
    y0: 0.5,
    y1: 0.75,
  });
});
function crop(id: string, pageNumber: number, y0: number, x0: number): StructureCropDraftItem {
  return {
    id,
    pageNumber,
    bounds: { x0, x1: 1, y0, y1: 1 },
    text: 'PART I',
    reviewedText: 'PART I',
    ocrDone: true,
    confidence: 95,
    warnings: [],
    error: null,
  };
}
void test('moving a region invalidates only its OCR and review; an unchanged region keeps its review', () => {
  const first = crop('a', 1, 0.25, 0.25);
  assert.equal(movedStructureCrop(first, { ...first.bounds }), first);
  const changed = movedStructureCrop(first, moveCropBounds(first.bounds, { x: -0.1, y: -0.1 }));
  assert.equal(changed.text, '');
  assert.equal(changed.reviewedText, null);
  assert.equal(changed.ocrDone, false);
  assert.equal(changed.confidence, null);
  const second = crop('b', 2, 0, 0);
  const draft = {
    version: 1 as const,
    fingerprint: 'pdf-hash',
    ordered: true,
    crops: [changed, second],
  };
  assert.equal(reviewedStructureText(draft).length, 0);
  assert.equal(second.reviewedText, 'PART I');
});
void test('reading order follows page then position; reviewed text preserves operator reorder', () => {
  const crops = [crop('c', 2, 0.1, 0), crop('b', 1, 0.2, 0.5), crop('a', 1, 0.2, 0)];
  assert.deepEqual(
    orderStructureCrops(crops).map((value) => value.id),
    ['a', 'b', 'c'],
  );
  const draft = { version: 1 as const, fingerprint: 'pdf-hash', ordered: true, crops };
  assert.deepEqual(
    reviewedStructureText(draft).map((value) => value.id),
    ['c', 'b', 'a'],
  );
  assert.equal(reviewedStructureText({ ...draft, ordered: false }).length, 0);
});
void test('editing any saved text invalidates AI input until reviewed again; saved blanks are distinct', () => {
  const original = crop('a', 1, 0, 0);
  const draft = { version: 1 as const, fingerprint: 'pdf-hash', ordered: true, crops: [original] };
  assert.equal(
    reviewedStructureText({ ...draft, crops: [{ ...original, text: 'PART II' }] }).length,
    0,
  );
  assert.equal(
    reviewedStructureText({ ...draft, crops: [{ ...original, reviewedText: null }] }).length,
    0,
  );
  assert.deepEqual(
    reviewedStructureText({ ...draft, crops: [{ ...original, text: '', reviewedText: '' }] }),
    [{ id: 'a', pageNumber: 1, text: '' }],
  );
});
void test('unfinished or failed OCR cannot be sent to AI even when an older review is saved', () => {
  const original = crop('a', 1, 0, 0);
  const draft = { version: 1 as const, fingerprint: 'pdf-hash', ordered: true, crops: [original] };
  for (const changed of [
    { ...original, ocrDone: false },
    { ...original, error: 'OCR failed. Retry this crop.' },
  ]) {
    assert.equal(reviewedStructureText({ ...draft, crops: [changed] }).length, 0);
    assert.equal(changed.text, original.text);
  }
  assert.equal(reviewedStructureText(draft).length, 1);
});
void test('draft roundtrip stores coordinates and OCR without binary PDF/image data', () => {
  const draft = {
    version: 1 as const,
    fingerprint: 'pdf-hash',
    ordered: true,
    crops: [crop('a', 1, 0, 0)],
  };
  assert.deepEqual(StructureCropDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  assert.equal(
    StructureCropDraftSchema.safeParse({ ...draft, image: 'data:image/png;base64,foo' }).success,
    false,
  );
});

void test('AI question types survive applying structure and exporting/reimporting its JSON', () => {
  const nodes = nodesFromConfig(
    [
      {
        label: 'Exercise-1',
        level: 'section',
        questionType: '',
        children: [
          {
            label: '1',
            level: 'part',
            questionType: '',
            children: [
              {
                label: 'Polymers',
                level: 'topic',
                questionType: 'subjective',
                children: [],
              },
              {
                label: '',
                level: 'topic',
                questionType: '',
                children: [],
              },
            ],
          },
        ],
      },
    ],
    false,
  );
  const exported = serializeConfig({ metadata: emptyMetadata(), nodes });
  const imported = parseConfig(JSON.stringify(exported));
  assert.ok(imported);
  const restored = nodesFromConfig(imported.nodes, false);
  const exercise = restored[0];
  assert.ok(exercise);
  const part = exercise.children[0];
  assert.ok(part);
  const topics = part.children;
  assert.deepEqual(
    topics.map((topic) => topic.questionType),
    ['subjective', ''],
  );
  assert.ok(topics.every((topic) => !topic.bindings));
  assert.equal(exercise.questionType, '');
  assert.equal(part.questionType, '');
});
