import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyMetadata } from '../src/features/ingestion/types/chapter-group.js';
import {
  nodesFromConfig,
  parseConfig,
  serializeConfig,
  configPageBindings,
} from '../src/features/ingestion/lib/structure-config.js';
import { isLeaf } from '../src/features/ingestion/types/structure-node.js';
import { structureHierarchy, type StructureHierarchyLevel } from '@ingest/contracts';
import { structureCropRolePresentation } from '../src/features/ingestion/lib/structure-crop-role.js';
import {
  cropBounds,
  moveCropBounds,
  movedStructureCrop,
  retypedStructureCrop,
  orderStructureCrops,
  reviewedStructureText,
  reviewedStructureCropResults,
  saveStructureCropResults,
  lockStructureCropSize,
  unlockStructureCropSize,
  placeLockedStructureCrop,
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

void test('a full generation persists reusable crop results through reload and rejects stale text or roles', () => {
  const draft = StructureCropDraftSchema.parse({
    version: 1,
    fingerprint: 'same-pdf',
    ordered: true,
    crops: [crop('a', 1, 0, 0), crop('b', 2, 0, 0), crop('c', 3, 0, 0)],
  });
  const results = draft.crops.map((item) => ({
    cropId: item.id,
    text: item.text,
    role: item.role ?? 'combined',
    contextKey: 'server-context',
    items: [{ section: null, part: null, topic: null, questionType: null }],
  }));
  const saved = saveStructureCropResults(draft, results, 'provider-rules', []);
  assert.deepEqual(reviewedStructureText(saved), reviewedStructureText(draft));
  const restored = StructureCropDraftSchema.parse(JSON.parse(JSON.stringify(saved)) as unknown);
  assert.deepEqual(reviewedStructureCropResults(restored.crops, 'provider-rules'), results);
  assert.deepEqual(reviewedStructureCropResults(restored.crops, 'changed-rules'), []);

  const edited = {
    ...restored,
    crops: restored.crops.map((item) =>
      item.id === 'b' ? { ...item, text: 'PART II', reviewedText: 'PART II', ai: null } : item,
    ),
  };
  const retried = saveStructureCropResults(edited, results, 'provider-rules', []);
  assert.deepEqual(reviewedStructureCropResults(retried.crops, 'provider-rules'), [
    results[0],
    results[2],
  ]);
  const retyped = {
    ...restored,
    crops: restored.crops.map((item) => retypedStructureCrop(item, 'topic')),
  };
  assert.ok(
    saveStructureCropResults(retyped, results, 'provider-rules', []).crops.every(
      (item) => !item.ai,
    ),
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

void test('Section, Part and Topic sizes persist independently without changing saved OCR or reading order', () => {
  const draft = StructureCropDraftSchema.parse({
    version: 1,
    fingerprint: 'locked-size-pdf',
    ordered: true,
    crops: [
      {
        ...crop('section', 1, 0, 0),
        role: 'section',
        bounds: { x0: 0.125, x1: 0.625, y0: 0.125, y1: 0.1875 },
      },
      {
        ...crop('part', 1, 0, 0),
        role: 'part',
        bounds: { x0: 0.125, x1: 0.875, y0: 0.25, y1: 0.28125 },
      },
      {
        ...crop('topic', 1, 0, 0),
        role: 'topic',
        bounds: { x0: 0.25, x1: 0.5, y0: 0.375, y1: 0.4375 },
      },
    ],
  });
  const locked = ['section', 'part', 'topic'].reduce(lockStructureCropSize, draft);
  assert.deepEqual(locked.lockedSizes, {
    section: { width: 0.5, height: 0.0625 },
    part: { width: 0.75, height: 0.03125 },
    topic: { width: 0.25, height: 0.0625 },
  });
  assert.equal(locked.crops, draft.crops);
  assert.equal(locked.ordered, true);
  assert.deepEqual(reviewedStructureText(locked), reviewedStructureText(draft));
  const restored = StructureCropDraftSchema.parse(JSON.parse(JSON.stringify(locked)) as unknown);
  assert.deepEqual(restored.lockedSizes, locked.lockedSizes);
  const unlocked = unlockStructureCropSize(restored, 'part');
  assert.equal(unlocked.lockedSizes?.part, undefined);
  assert.deepEqual(unlocked.lockedSizes?.section, locked.lockedSizes.section);
  assert.deepEqual(unlocked.lockedSizes.topic, locked.lockedSizes.topic);
  assert.equal(unlockStructureCropSize(unlocked, 'part'), unlocked);
  assert.equal(lockStructureCropSize(draft, 'missing'), draft);
});

void test('one-click placement preserves locked dimensions at every page edge', () => {
  const size = { width: 0.25, height: 0.125 };
  assert.deepEqual(placeLockedStructureCrop(size, { x: 0.25, y: 0.375 }), {
    x0: 0.25,
    x1: 0.5,
    y0: 0.375,
    y1: 0.5,
  });
  assert.deepEqual(placeLockedStructureCrop(size, { x: 2, y: 2 }), {
    x0: 0.75,
    x1: 1,
    y0: 0.875,
    y1: 1,
  });
  assert.deepEqual(placeLockedStructureCrop(size, { x: -1, y: -1 }), {
    x0: 0,
    x1: 0.25,
    y0: 0,
    y1: 0.125,
  });
  assert.deepEqual(placeLockedStructureCrop({ width: 1, height: 0.125 }, { x: 0.5, y: 0.25 }), {
    x0: 0,
    x1: 1,
    y0: 0.25,
    y1: 0.375,
  });
});

void test('legacy drafts remain valid and custom hierarchy levels can keep separate size presets', () => {
  const draft = StructureCropDraftSchema.parse({
    version: 1,
    fingerprint: 'other-pdf',
    ordered: false,
    crops: [{ ...crop('custom', 1, 0.25, 0.25), role: 'subpart' }],
  });
  assert.equal(draft.lockedSizes, undefined);
  assert.deepEqual(lockStructureCropSize(draft, 'custom').lockedSizes, {
    subpart: { width: 0.75, height: 0.75 },
  });
  for (const width of [0, -1, 2])
    assert.equal(
      StructureCropDraftSchema.safeParse({
        ...draft,
        lockedSizes: { subpart: { width, height: 0.1 } },
      }).success,
      false,
    );
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
void test('a blank OCR response stays unresolved until the operator enters and saves text', () => {
  const original = crop('a', 1, 0, 0);
  const blank = {
    ...original,
    text: '',
    reviewedText: null,
    ocrDone: false,
    confidence: null,
    error:
      'OCR found no readable text for this crop. Adjust or retry the crop, or type the visible heading text manually.',
  };
  const draft = { version: 1 as const, fingerprint: 'pdf-hash', ordered: true, crops: [blank] };
  assert.deepEqual(reviewedStructureText(draft), []);

  const manuallyCorrected = {
    ...blank,
    text: 'PART II',
    reviewedText: 'PART II',
    ocrDone: true,
    error: null,
  };
  assert.deepEqual(reviewedStructureText({ ...draft, crops: [manuallyCorrected] }), [
    { id: 'a', pageNumber: 1, text: 'PART II' },
  ]);
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

void test('Parts without Topics remain leaves through apply/export/import and keep page bindings', () => {
  const nodes = nodesFromConfig(
    [
      {
        label: 'Exercise-2',
        level: 'section',
        questionType: '',
        children: [
          { label: '1', level: 'part', questionType: 'single_correct', children: [] },
          { label: '2', level: 'part', questionType: 'integer', children: [] },
        ],
      },
      { label: 'Exercise-3', level: 'section', questionType: 'subjective', children: [] },
    ],
    false,
  );
  const firstPart = nodes[0]?.children[0];
  assert.ok(firstPart);
  assert.ok(isLeaf(firstPart));
  firstPart.bindings = {
    question: {
      id: 'manual-question',
      bytes: new Uint8Array(),
      pageCount: 2,
      pageNumbers: [4, 5],
      sourceLabel: 'pages 4–5',
    },
  };
  const imported = parseConfig(
    JSON.stringify(serializeConfig({ metadata: emptyMetadata(), nodes })),
  );
  assert.ok(imported);
  const restored = nodesFromConfig(imported.nodes, false);
  const exercise = restored[0];
  assert.ok(exercise);
  assert.deepEqual(
    exercise.children.map((part) => [part.level, part.label, part.questionType, part.children]),
    [
      ['part', '1', 'single_correct', []],
      ['part', '2', 'integer', []],
    ],
  );
  const sectionOnly = restored[1];
  assert.ok(sectionOnly);
  assert.ok(isLeaf(sectionOnly));
  assert.equal(sectionOnly.questionType, 'subjective');
  assert.deepEqual(configPageBindings(imported.nodes, restored), [
    { leafId: exercise.children[0]?.id, kind: 'question', pages: [4, 5] },
  ]);
});

void test('typed crops persist roles and send them with reviewed text; older drafts remain combined', () => {
  const item = { ...crop('typed', 1, 0, 0), role: 'part' as const };
  const draft = { version: 1 as const, fingerprint: 'pdf', ordered: true, crops: [item] };
  const restored = StructureCropDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
  assert.equal(restored.crops[0]?.role, 'part');
  assert.deepEqual(reviewedStructureText(restored), [
    { id: 'typed', pageNumber: 1, text: 'PART I', role: 'part' },
  ]);
  const legacy = StructureCropDraftSchema.parse({ ...draft, crops: [crop('old', 1, 0, 0)] });
  assert.equal(legacy.crops[0]?.role ?? 'combined', 'combined');
  assert.equal(
    StructureCropDraftSchema.safeParse({ ...draft, crops: [{ ...item, role: 'answer' }] }).success,
    false,
  );
});

void test('changing a crop role preserves OCR but requires review and discards stale AI results', () => {
  const item = crop('typed', 1, 0, 0);
  item.ai = {
    contextKey: 'same',
    warnings: [],
    result: { cropId: item.id, text: item.text, contextKey: 'server', items: [] },
  };
  assert.equal(retypedStructureCrop(item, 'combined'), item);
  const changed = retypedStructureCrop(item, 'part');
  assert.equal(changed.text, item.text);
  assert.equal(changed.ocrDone, true);
  assert.equal(changed.reviewedText, null);
  assert.equal(changed.ai, null);
  assert.equal(reviewedStructureCropResults([{ ...item, role: 'part' }], 'same').length, 0);
  const draft = { version: 1 as const, fingerprint: 'pdf', ordered: true, crops: [changed] };
  assert.deepEqual(reviewedStructureText(draft), []);
  assert.equal(
    reviewedStructureText({ ...draft, crops: [{ ...changed, reviewedText: changed.text }] })[0]
      ?.role,
    'part',
  );
});

void test('custom hierarchy ids, names, order and manual bindings survive exported JSON', () => {
  const hierarchy: StructureHierarchyLevel[] = [
    { id: 'section', name: 'Exercise', example: 'Exercise-1', expectedOutput: 'Exercise-1' },
    { id: 'part', name: 'Part', example: 'PART I', expectedOutput: 'I' },
    { id: 'subpart', name: 'Subpart', example: 'Subpart A', expectedOutput: 'A' },
    { id: 'topic', name: 'Concept', example: 'Section (A): Phenol', expectedOutput: 'Phenol' },
  ];
  const nodes = nodesFromConfig(
    [
      {
        label: 'Exercise-1',
        level: 'section',
        children: [
          {
            label: 'I',
            level: 'part',
            children: [
              {
                label: 'A',
                level: 'subpart',
                children: [
                  { label: 'Phenol', level: 'topic', questionType: 'single_correct', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
    false,
  );
  const parsed = parseConfig(
    JSON.stringify(serializeConfig({ metadata: emptyMetadata(), nodes, hierarchy })),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.hierarchy, hierarchy);
  const restored = nodesFromConfig(parsed.nodes, false);
  assert.equal(restored[0]?.children[0]?.children[0]?.level, 'subpart');
  assert.equal(restored[0].children[0].children[0].children[0]?.questionType, 'single_correct');
  assert.equal(structureCropRolePresentation('topic', hierarchy).label, 'Concept');
  assert.equal(structureCropRolePresentation('subpart', hierarchy).label, 'Subpart');
  assert.equal(
    structureCropRolePresentation('subpart', [...hierarchy].reverse()).color,
    structureCropRolePresentation('subpart', hierarchy).color,
  );
  assert.equal(
    parseConfig(JSON.stringify({ ...parsed, hierarchy: [hierarchy[0], hierarchy[0]] })),
    null,
  );
  assert.equal(structureHierarchy().length, 3);
});

void test('drawing all levels in separate passes sorts by PDF position and retains custom crop roles', () => {
  const crops = [
    { ...crop('section-1', 1, 0.1, 0), role: 'section' },
    { ...crop('section-2', 5, 0.1, 0), role: 'section' },
    { ...crop('part-1', 1, 0.2, 0), role: 'part' },
    { ...crop('part-2', 4, 0.1, 0), role: 'part' },
    { ...crop('subpart', 1, 0.3, 0), role: 'subpart' },
    { ...crop('topic-1', 1, 0.4, 0), role: 'topic' },
    { ...crop('topic-2', 2, 0.1, 0), role: 'topic' },
  ];
  const ordered = orderStructureCrops(crops);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ['section-1', 'part-1', 'subpart', 'topic-1', 'topic-2', 'part-2', 'section-2'],
  );
  const draft = StructureCropDraftSchema.parse({
    version: 1,
    fingerprint: 'different-module',
    ordered: true,
    crops: ordered,
  });
  assert.equal(reviewedStructureText(draft)[2]?.role, 'subpart');
});
