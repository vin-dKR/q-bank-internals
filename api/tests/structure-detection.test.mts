import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';
import { z } from 'zod';
import {
  estimateStructure,
  structureCostUsd,
  structurePricing,
} from '../src/infrastructure/ai/structure-cost.js';
import { AppError } from '../src/shared/errors/app-error.js';
import {
  EMPTY_PAPER_METADATA,
  partNameFromHeading,
  topicNameFromHeading,
  type DetectedStructureNode,
  type StructureDetectionContext,
  SaveStructureRuleSchema,
  StructureRuleSchema,
  structureRuleScope,
  structureRuleScopeKey,
  type StructureRule,
  type StructureTextCrop,
  type StructureCropRole,
  type StructureCropOcrResult,
  StructureEstimateRequestSchema,
  StructureHierarchySchema,
  structureHierarchy,
  type StructureHierarchyLevel,
  KNOWN_QUESTION_TYPES,
  DetectedStructureSchema,
  DetectStructureRequestSchema,
} from '@ingest/contracts';
import {
  structureTextBatches,
  structureCropContextKey,
} from '../src/modules/ingestion/structure-text-batches.js';
import { validateStructure } from '../src/modules/ingestion/validate-structure.js';
import {
  StructurePageAccumulator,
  StructurePageObservationSchema,
  type StructurePageObservation,
} from '../src/modules/ingestion/structure-page.js';
import {
  STRUCTURE_SYSTEM_PROMPT,
  structureJsonSchema,
  structurePrompt,
} from '../src/infrastructure/ai/prompts/structure-prompts.js';
import { OpenAiStructureExtractor } from '../src/infrastructure/ai/openai.structure-extractor.js';
import { IngestionService } from '../src/modules/ingestion/ingestion.service.js';
import { StructureRulesService } from '../src/modules/structure-rules/index.js';
import { InMemoryStructureRuleStore } from '../src/infrastructure/database/repositories/structure-rule.in-memory-store.js';
import { MongoStructureRuleStore } from '../src/infrastructure/database/repositories/structure-rule.mongo-store.js';
import {
  structureHeadingCandidates,
  type StructureHeadingCandidates,
} from '../src/modules/ingestion/structure-heading-evidence.js';
import { TesseractPageOcr } from '../src/infrastructure/pdf/tesseract.page-ocr.js';
import { mergeOcrLines } from '../src/infrastructure/pdf/ocr-line-merge.js';
import { structureQuestionTypeEvidence } from '../src/modules/ingestion/structure-question-type.js';
import type { OcrLine, PageOcr } from '../src/modules/ingestion/page-ocr.js';

const emptyOcr: PageOcr = {
  open: async () => ({ recognize: async () => [], close: async () => {} }),
};
/** Schema and Mongo command assertions validate unknown JSON before reading nested fields. */
function jsonAt(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    assert.ok(current !== null && typeof current === 'object');
    current = Reflect.get(current, key);
  }
  return current;
}
function adapterFor(model: string): OpenAiStructureExtractor {
  return new OpenAiStructureExtractor('test-key', model);
}
type ModelRequest = {
  reasoning_effort?: string;
  max_completion_tokens: number;
  messages: { role: string; content: string }[];
  response_format: { json_schema: { schema: Record<string, unknown> } };
};
function fakeModel(
  adapter: OpenAiStructureExtractor,
  respond: (request: ModelRequest) => unknown,
  finishReason = 'stop',
): void {
  Object.assign(adapter, {
    client: {
      chat: {
        completions: {
          create: async (request: ModelRequest) => ({
            choices: [
              {
                finish_reason: finishReason,
                message: { content: JSON.stringify(await respond(request)) },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          }),
        },
      },
    },
  });
}
function batchResponse(
  crops: StructureTextCrop[],
  items: StructurePageObservation['items'][],
): unknown {
  return { crops: crops.map((crop, index) => ({ cropId: crop.id, items: items[index] ?? [] })) };
}
function ocrLine(text: string, top: number, confidence = 95): OcrLine {
  return { text, confidence, box: { left: 30, top, right: 570, bottom: top + 20 } };
}

const savedRule: StructureRule = {
  source: 'module',
  provider: 'Resonance',
  examples: {
    section: 'Exercise-1',
    part: 'PART I: SUBJECTIVE QUESTIONS',
    topic: 'Section (A): Polymers',
  },
  notes: 'Use the printed Exercise heading as Section.',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const ruleInput = {
  source: savedRule.source,
  provider: savedRule.provider,
  examples: savedRule.examples,
  notes: savedRule.notes,
};
const customRule: StructureRule = {
  ...savedRule,
  provider: 'Other module',
  examples: {
    section: 'Practice Sheet-2',
    part: 'Level 2: Objective Questions',
    topic: 'Block B: Chemical Bonding',
  },
  expectedOutputs: { section: 'Practice Sheet-2', part: '2', topic: 'Chemical Bonding' },
};

const textCrops = [
  { id: 'crop-1', pageNumber: 1, text: 'Exercise-1\nPART 1\nSection (A): Polymers' },
];
const context: StructureDetectionContext = {
  className: '',
  source: 'module',
  exam: 'JEE',
  subject: 'Chemistry',
  module: 'Resonance',
  chapter: 'Organic Reaction Mechanisms-I',
  sectionName: '',
  questionType: '',
  pyq: false,
  pyqExam: '',
  pyqYear: '',
  paper: { ...EMPTY_PAPER_METADATA },
  answerLayout: 'separate',
};
function leaf(patch: Partial<DetectedStructureNode> = {}): DetectedStructureNode {
  return {
    label: '1',
    level: 'part',
    questionType: '',
    subject: '',
    pyq: false,
    pages: { question: [], answer: [], solution: null },
    children: [],
    ...patch,
  };
}
function observation(
  patch: Partial<StructurePageObservation['items'][number]> = {},
): StructurePageObservation {
  return { items: [{ section: null, part: '1', topic: null, ...patch }] };
}
function read(accumulator: StructurePageAccumulator, page: number, value: unknown): void {
  // These unit fixtures supply matching source evidence; grounding tests supply different PDF text.
  const candidates: StructureHeadingCandidates = { section: [], part: [], topic: [] };
  const parsed = StructurePageObservationSchema.safeParse(value);
  for (const item of parsed.success ? parsed.data.items : []) {
    for (const level of ['section', 'part', 'topic'] as const) {
      const heading = item[level];
      if (heading != null)
        candidates[level]?.push(typeof heading === 'string' ? heading : heading.printed);
    }
  }
  accumulator.accept(page, value, candidates);
}

function readText(
  accumulator: StructurePageAccumulator,
  page: number,
  text: string,
  items: StructurePageObservation['items'],
): void {
  const lines = text.split(/\r?\n/u);
  accumulator.accept(
    page,
    { items },
    structureHeadingCandidates(lines, null, true),
    structureQuestionTypeEvidence(lines),
  );
}

const fourLevelRule: StructureRule = {
  ...savedRule,
  hierarchy: [
    { id: 'section', name: 'Exercise', example: 'Exercise-1', expectedOutput: 'Exercise-1' },
    { id: 'part', name: 'Part', example: 'PART I: SUBJECTIVE QUESTIONS', expectedOutput: 'I' },
    { id: 'subpart', name: 'Subpart', example: 'Subpart A', expectedOutput: 'A' },
    { id: 'topic', name: 'Concept', example: 'Section (A): Phenol', expectedOutput: 'Phenol' },
  ],
};

void test('a maximum-size hierarchy guide fits saved crop context without rejecting valid drafts', () => {
  const examples = { section: 'S'.repeat(500), part: 'P'.repeat(500), topic: 'T'.repeat(500) };
  const rule: StructureRule = {
    ...savedRule,
    examples,
    expectedOutputs: examples,
    notes: 'N'.repeat(2000),
    hierarchy: Array.from({ length: 16 }, (_, index) => ({
      id: `level-${String(index)}`,
      name: `Level ${String(index + 1)}`,
      example: `Heading ${String(index + 1)}`.padEnd(500, 'x'),
      expectedOutput: `Heading ${String(index + 1)}`.padEnd(500, 'x'),
    })),
  };
  assert.ok(
    SaveStructureRuleSchema.safeParse({
      ...ruleInput,
      examples: rule.examples,
      expectedOutputs: rule.expectedOutputs,
      notes: rule.notes,
      hierarchy: rule.hierarchy,
    }).success,
  );
  const contextKey = structureCropContextKey(context, rule);
  assert.ok(contextKey.length > 20000);
  const crop = { id: 'large-guide', pageNumber: 1, text: 'Heading 1', role: 'level-0' };
  assert.ok(
    StructureEstimateRequestSchema.safeParse({
      pageCount: 1,
      context,
      crops: [crop],
      savedCrops: [{ cropId: crop.id, text: crop.text, role: crop.role, contextKey, items: [] }],
    }).success,
  );
});

void test('provider hierarchies start at three levels and validate renaming, removal and inserted levels', async () => {
  assert.deepEqual(
    structureHierarchy().map((level) => level.name),
    ['Section', 'Part', 'Topic'],
  );
  assert.equal(structureHierarchy(savedRule)[1]?.example, savedRule.examples.part);
  const hierarchy = StructureHierarchySchema.parse(fourLevelRule.hierarchy);
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  await service.save({ ...ruleInput, hierarchy });
  assert.deepEqual((await service.resolveContext(context))?.hierarchy, hierarchy);
  assert.equal(await service.resolveContext({ ...context, module: 'Allen' }), null);
  const changed = [hierarchy[2], hierarchy[0], hierarchy[3]].filter(
    (level): level is StructureHierarchyLevel => level !== undefined,
  );
  await service.save({ ...ruleInput, hierarchy: changed });
  assert.deepEqual(
    structureHierarchy(await service.resolveContext(context)).map((level) => level.id),
    ['subpart', 'section', 'topic'],
  );
  assert.equal(
    SaveStructureRuleSchema.safeParse({
      ...ruleInput,
      examples: { section: '', part: '', topic: '' },
      notes: '',
      hierarchy: structureHierarchy(),
    }).success,
    true,
  );
  assert.equal(StructureHierarchySchema.safeParse([]).success, false);
  assert.equal(StructureHierarchySchema.safeParse([...hierarchy, hierarchy[0]]).success, false);
  assert.equal(
    StructureHierarchySchema.safeParse([...hierarchy, { ...hierarchy[0], id: 'other' }]).success,
    false,
  );
});

void test('four configured crop levels drive strict AI fields, parent carry/reset and cached rebuilds', async () => {
  const crops: StructureTextCrop[] = [
    { id: 'exercise', pageNumber: 1, role: 'section', text: 'Exercise-1' },
    { id: 'part', pageNumber: 1, role: 'part', text: 'PART I: SUBJECTIVE QUESTIONS' },
    { id: 'subpart-a', pageNumber: 1, role: 'subpart', text: 'Subpart A' },
    { id: 'phenol', pageNumber: 1, role: 'topic', text: 'Section (A): Phenol' },
    { id: 'amines', pageNumber: 2, role: 'topic', text: 'Section (B): Amines' },
    { id: 'subpart-b', pageNumber: 3, role: 'subpart', text: 'Subpart B' },
    { id: 'nitrogen', pageNumber: 3, role: 'topic', text: 'Section (C): Nitrogen compounds' },
    { id: 'part-ii', pageNumber: 4, role: 'part', text: 'PART II: SINGLE CORRECT' },
    { id: 'exercise-2', pageNumber: 5, role: 'section', text: 'Exercise-2' },
  ];
  const labels = [
    'Exercise-1',
    'I',
    'A',
    'Phenol',
    'Amines',
    'B',
    'Nitrogen compounds',
    'II',
    'Exercise-2',
  ];
  const hierarchy = structureHierarchy(fourLevelRule);
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, (request) => {
    const index = calls++;
    const crop = crops[index];
    assert.ok(crop);
    const headingFields = jsonAt(
      request.response_format.json_schema.schema,
      'properties',
      'crops',
      'items',
      'properties',
      'items',
      'items',
      'properties',
      'headings',
    );
    assert.deepEqual(
      jsonAt(headingFields, 'required'),
      hierarchy.map((level) => level.id),
    );
    for (const level of hierarchy) {
      if (level.id !== crop.role)
        assert.deepEqual(jsonAt(headingFields, 'properties', level.id), { type: 'null' });
    }
    const printedType = structureQuestionTypeEvidence(crop.text.split('\n'))[0];
    if (crop.id === 'part-ii')
      assert.doesNotMatch(request.messages[1]?.content ?? '', /"subpart":"Subpart B"/);
    const role = crop.role;
    assert.ok(role && role !== 'combined');
    return batchResponse(
      [crop],
      [
        [
          {
            headings: Object.fromEntries(
              hierarchy.map((level) => [
                level.id,
                level.id === role ? { printed: crop.text, label: labels[index] ?? '' } : null,
              ]),
            ),
            questionType: printedType ? { ...printedType, level: role } : null,
          },
        ],
      ],
    );
  });
  const input = { crops, context, rule: fourLevelRule, pageCount: 5, onUsage: async () => {} };
  const result = DetectedStructureSchema.parse(await adapter.extract(input));
  validateStructure(result, 5, 'separate', fourLevelRule);
  const exercise = result.nodes[0];
  assert.ok(exercise);
  const firstPart = exercise.children[0];
  assert.ok(firstPart);
  assert.deepEqual(
    firstPart.children.map((node) => [node.level, node.label]),
    [
      ['subpart', 'A'],
      ['subpart', 'B'],
    ],
  );
  assert.deepEqual(
    firstPart.children[0]?.children.map((node) => [node.label, node.questionType]),
    [
      ['Phenol', 'subjective'],
      ['Amines', 'subjective'],
    ],
  );
  assert.equal(firstPart.children[1]?.children[0]?.label, 'Nitrogen compounds');
  assert.equal(exercise.children[1]?.questionType, 'single_correct');
  assert.deepEqual(exercise.children[1].children, []);
  assert.deepEqual(result.nodes[1]?.children, []);
  assert.ok(result.cropResults?.[2]?.items[0]?.headings?.subpart);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls, crops.length);
  fakeModel(adapter, () => {
    throw new Error('Saved dynamic crops should not request AI again');
  });
  const reused = DetectedStructureSchema.parse(
    await adapter.extract({ ...input, savedCrops: result.cropResults ?? [] }),
  );
  assert.equal(reused.aiCallCount, 0);
  assert.deepEqual(reused.nodes, result.nodes);
  assert.equal(
    estimateStructure('gpt-5.4-mini', { ...input, savedCrops: result.cropResults ?? [] }).callCount,
    0,
  );
  const reordered = { ...fourLevelRule, hierarchy: [...hierarchy].reverse() };
  assert.equal(
    estimateStructure('gpt-5.4-mini', {
      ...input,
      rule: reordered,
      savedCrops: result.cropResults ?? [],
    }).callCount,
    crops.length,
  );
});

void test('combined crops support custom levels while removed and unknown levels are rejected', () => {
  const rule = {
    ...fourLevelRule,
    hierarchy: structureHierarchy(fourLevelRule).filter((level) => level.id !== 'part'),
  };
  const acc = new StructurePageAccumulator(context, rule);
  const text = ['Exercise-1', 'Subpart A', 'Section (A): Phenol'];
  acc.accept(
    1,
    {
      items: [
        {
          headings: {
            section: { printed: text[0], label: 'Exercise-1' },
            subpart: { printed: text[1], label: 'A' },
            topic: { printed: text[2], label: 'Phenol' },
          },
          questionType: null,
        },
      ],
    },
    structureHeadingCandidates(text, rule, true),
  );
  const result = validateStructure(acc.result(), 1, 'separate', rule);
  assert.equal(result.nodes[0]?.children[0]?.level, 'subpart');
  assert.equal(result.nodes[0].children[0].children[0]?.label, 'Phenol');
  acc.accept(
    2,
    { items: [{ headings: { part: 'PART I' }, questionType: null }] },
    { part: ['PART I'] },
    [],
    'part',
  );
  assert.match(acc.result().warnings.join(' '), /removed or unknown hierarchy level/);
  assert.throws(
    () => validateStructure({ nodes: [leaf({ level: 'unknown' })] }, 1, 'separate', rule),
    /hierarchy/,
  );
  assert.throws(
    () => validateStructure({ nodes: [leaf({ level: 'part' })] }, 1, 'separate', rule),
    /hierarchy/,
  );
});

void test('an explicitly cropped custom chapter level can use the printed chapter title as evidence', async () => {
  const chapterLevel: StructureHierarchyLevel = {
    id: 'unit',
    name: 'Unit',
    example: context.chapter,
    expectedOutput: context.chapter,
  };
  const rule = {
    ...fourLevelRule,
    hierarchy: [chapterLevel, ...structureHierarchy(fourLevelRule)],
  };
  const crop: StructureTextCrop = {
    id: 'chapter',
    pageNumber: 1,
    role: 'unit',
    text: context.chapter,
  };
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, (request) => {
    assert.match(
      request.messages[1]?.content ?? '',
      /"candidates":\["Organic Reaction Mechanisms-I"\]/,
    );
    return batchResponse(
      [crop],
      [
        [
          {
            headings: { unit: { printed: context.chapter, label: context.chapter } },
            questionType: null,
          },
        ],
      ],
    );
  });
  const result = DetectedStructureSchema.parse(
    await adapter.extract({ crops: [crop], pageCount: 1, context, rule, onUsage: async () => {} }),
  );
  assert.equal(result.nodes[0]?.level, 'unit');
  assert.equal(result.nodes[0].label, context.chapter);
  assert.deepEqual(result.nodes[0].children, []);
  assert.deepEqual(result.warnings, []);
});

void test('custom identifier outputs cannot copy a sample letter onto a different heading', () => {
  const acc = new StructurePageAccumulator(context, fourLevelRule);
  const text = 'Subpart B';
  acc.accept(
    1,
    { items: [{ headings: { subpart: { printed: text, label: 'A' } }, questionType: null }] },
    structureHeadingCandidates([text], fourLevelRule, true, 'subpart'),
    [],
    'subpart',
  );
  assert.deepEqual(acc.result().nodes, []);
  assert.match(acc.result().warnings.join(' '), /changed its printed identifier/);
});

void test('per-crop extraction returns cleaned fields and excludes chapter and instruction text', async () => {
  const crop = {
    id: 'preview',
    pageNumber: 1,
    text: 'Aromatic Compounds\nIl Exercise-1\n2 Marked questions are recommended for Revision.\nPART - 1: SUBJECTIVE QUESTIONS\nSection (A): Phenol',
  };
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () =>
    batchResponse(
      [crop],
      [
        [
          {
            section: { printed: 'Il Exercise-1', label: 'Exercise-1' },
            part: { printed: 'PART - 1: SUBJECTIVE QUESTIONS', label: '1' },
            topic: { printed: 'Section (A): Phenol', label: 'Phenol' },
            questionType: {
              value: 'subjective',
              printed: 'PART - 1: SUBJECTIVE QUESTIONS',
              level: 'part',
            },
          },
        ],
      ],
    ),
  );
  const result = DetectedStructureSchema.parse(
    await adapter.extract({
      crops: [crop],
      pageCount: 1,
      context: { ...context, chapter: 'Aromatic Compounds' },
      onUsage: async () => {},
    }),
  );
  assert.equal(result.aiCallCount, 1);
  assert.deepEqual(result.cropResults?.[0]?.items[0], {
    section: { printed: 'Il Exercise-1', label: 'Exercise-1' },
    part: { printed: 'PART - 1: SUBJECTIVE QUESTIONS', label: '1' },
    topic: { printed: 'Section (A): Phenol', label: 'Phenol' },
    questionType: { value: 'subjective', printed: 'PART - 1: SUBJECTIVE QUESTIONS', level: 'part' },
  });
  assert.equal(crop.text.includes('Il Exercise-1'), true);
});

void test('operator-selected crop roles constrain candidates, prompt and schema without inventing headings', () => {
  const lines = [
    'Practice Set Alpha',
    '* Marked Questions may have more than one correct option.',
    'AIPMT 2006',
    '1. Identify the compound.',
  ];
  const candidates = structureHeadingCandidates(lines, null, true, 'section');
  assert.deepEqual(candidates, { section: ['Practice Set Alpha'], part: [], topic: [] });
  const evidence = structureQuestionTypeEvidence(['PART I: SUBJECTIVE QUESTIONS']);
  const schema = structureJsonSchema(null, candidates, ['one'], evidence, 'section');
  const fields = jsonAt(
    schema,
    'properties',
    'crops',
    'items',
    'properties',
    'items',
    'items',
    'properties',
  );
  assert.deepEqual(jsonAt(fields, 'part'), { type: 'null' });
  assert.deepEqual(jsonAt(fields, 'topic'), { type: 'null' });
  assert.deepEqual(jsonAt(fields, 'questionType', 'anyOf', '0', 'properties', 'level', 'enum'), [
    'section',
  ]);
  assert.match(
    structurePrompt(context, [
      { id: 'one', pageNumber: 1, text: lines[0] ?? '', role: 'section', candidates },
    ]),
    /selected level is authoritative: section/,
  );
  assert.match(STRUCTURE_SYSTEM_PROMPT, /operator-selected crop role.*authoritative/);
  assert.equal(
    DetectStructureRequestSchema.safeParse({
      crops: [{ ...textCrops[0], role: 'answer' }],
      pageCount: 1,
      context,
    }).success,
    false,
  );
});

void test('typed crops carry parents across crops, clear children on changes and preserve evidenced types', async () => {
  const values: Array<{ role: StructureCropRole; text: string }> = [
    { role: 'section', text: 'Exercise-1' },
    { role: 'part', text: 'PART I: SUBJECTIVE QUESTIONS' },
    { role: 'topic', text: 'Section (A): Phenol' },
    { role: 'topic', text: 'Section (B): Amines' },
    { role: 'part', text: 'PART II: SINGLE CORRECT' },
    { role: 'topic', text: 'Section (G): Magnetic force on a charge (oblique incidence)' },
    { role: 'section', text: 'Exercise-2' },
    { role: 'part', text: 'PART I\nSUBJECTIVE QUESTIONS' },
  ];
  const crops: StructureTextCrop[] = values.map((value, index) => ({
    ...value,
    id: `typed-${String(index)}`,
    pageNumber: index + 1,
  }));
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, (request) => {
    const crop = crops[calls++];
    assert.ok(crop && crop.role && crop.role !== 'combined');
    const fields = jsonAt(
      request.response_format.json_schema.schema,
      'properties',
      'crops',
      'items',
      'properties',
      'items',
      'items',
      'properties',
    );
    for (const level of ['section', 'part', 'topic'])
      if (level !== crop.role) assert.deepEqual(jsonAt(fields, level), { type: 'null' });
    const type = structureQuestionTypeEvidence(crop.text.split('\n'))[0];
    const item: StructurePageObservation['items'][number] = {
      section: null,
      part: null,
      topic: null,
      questionType: type ? { ...type, level: crop.role } : null,
    };
    item.headings = { [crop.role]: crop.text.split('\n')[0] ?? crop.text };
    return batchResponse([crop], [[item]]);
  });
  const input = { crops, context, pageCount: crops.length, onUsage: async () => {} };
  const result = DetectedStructureSchema.parse(await adapter.extract(input));
  assert.equal(result.aiCallCount, crops.length);
  const first = result.nodes[0];
  assert.ok(first);
  assert.equal(first.label, 'Exercise-1');
  assert.deepEqual(
    first.children.map((part) => part.label),
    ['I', 'II'],
  );
  assert.deepEqual(
    first.children[0]?.children.map((topic) => [topic.label, topic.questionType]),
    [
      ['Phenol', 'subjective'],
      ['Amines', 'subjective'],
    ],
  );
  assert.deepEqual(
    first.children[1]?.children.map((topic) => [topic.label, topic.questionType]),
    [['Magnetic force on a charge (oblique incidence)', 'single_correct']],
  );
  assert.equal(result.nodes[1]?.label, 'Exercise-2');
  assert.deepEqual(result.nodes[1].children[0]?.children, []);
  assert.equal(result.nodes[1].children[0].questionType, 'subjective');
  assert.ok(result.cropResults?.every((crop, index) => crop.role === crops[index]?.role));
  assert.deepEqual(result.warnings, []);
  fakeModel(adapter, () => {
    throw new Error('Unchanged typed crops must be reused');
  });
  const reused = DetectedStructureSchema.parse(
    await adapter.extract({ ...input, savedCrops: result.cropResults ?? [] }),
  );
  assert.equal(reused.aiCallCount, 0);
  assert.deepEqual(reused.nodes, result.nodes);
});

void test('typed prompts omit unrelated context and examples while retaining cleanup and evidence rules', () => {
  const crop: StructureTextCrop = {
    id: 'part-only',
    pageNumber: 1,
    role: 'part',
    text: 'PART II: SINGLE CORRECT',
  };
  const candidates = structureHeadingCandidates(crop.text.split('\n'), savedRule, true, crop.role);
  const questionTypeEvidence = structureQuestionTypeEvidence(crop.text.split('\n'));
  const state: ReturnType<StructurePageAccumulator['pageContext']> = {
    previous: { section: 'Exercise-999', part: 'PART I', topic: 'Unrelated preceding topic' },
    questionTypes: { section: '', part: 'subjective', topic: '' },
  };
  const typed = structurePrompt(
    context,
    [{ ...crop, candidates, questionTypeEvidence }],
    state,
    savedRule,
  );
  const combined = structurePrompt(
    context,
    [{ ...crop, role: 'combined', candidates, questionTypeEvidence }],
    state,
    savedRule,
  );
  assert.ok(typed.length < combined.length / 2);
  assert.doesNotMatch(typed, /Exercise-999|Unrelated preceding topic|Polymers/);
  assert.ok(!typed.includes(context.chapter));
  assert.match(typed, /"output":"I"/);
  assert.match(typed, /"value":"single_correct"/);
  assert.match(typed, /only the selected level/);
  assert.match(typed, /Never guess damaged identifiers/);
  assert.match(typed, /type-only line does not create a heading/);
});

void test(
  'three typed calls finish in reverse order; Combined waits for replay, and retries request only changed text',
  { timeout: 5000 },
  async () => {
    const crops: StructureTextCrop[] = [
      { id: 'exercise', pageNumber: 1, role: 'section', text: 'Exercise-1' },
      { id: 'part-i', pageNumber: 1, role: 'part', text: 'PART I: SUBJECTIVE QUESTIONS' },
      { id: 'phenol', pageNumber: 1, role: 'topic', text: 'Section (A): Phenol' },
      { id: 'amines', pageNumber: 2, role: 'topic', text: 'Section (B): Amines' },
      { id: 'part-ii', pageNumber: 3, role: 'part', text: 'PART II: SINGLE CORRECT' },
      { id: 'nitrogen', pageNumber: 3, role: 'topic', text: 'Section (C): Nitrogen compounds' },
      { id: 'combined', pageNumber: 4, role: 'combined', text: 'Exercise-2\nPART I: INTEGER TYPE' },
      { id: 'polymers', pageNumber: 4, role: 'topic', text: 'Section (A): Polymers' },
      { id: 'hydrocarbons', pageNumber: 5, role: 'topic', text: 'Section (B): Hydrocarbons' },
      { id: 'isomers', pageNumber: 6, role: 'topic', text: 'Section (C): Isomers' },
    ];
    const adapter = adapterFor('gpt-5.4-mini');
    let active = 0;
    let peak = 0;
    let usage = 0;
    let gates: Array<{ id: string; release: () => void }> = [];
    const completed: string[] = [];
    const itemsFor = (crop: StructureTextCrop): StructurePageObservation['items'] => {
      const type = structureQuestionTypeEvidence(crop.text.split('\n'))[0];
      return [
        {
          section:
            crop.role === 'section' ? crop.text : crop.role === 'combined' ? 'Exercise-2' : null,
          part:
            crop.role === 'part'
              ? crop.text
              : crop.role === 'combined'
                ? 'PART I: INTEGER TYPE'
                : null,
          topic: crop.role === 'topic' ? crop.text : null,
          questionType: type ? { ...type, level: 'part' } : null,
        },
      ];
    };
    const cropFor = (request: ModelRequest): StructureTextCrop => {
      const ids = z
        .array(z.string())
        .parse(
          jsonAt(
            request.response_format.json_schema.schema,
            'properties',
            'crops',
            'items',
            'properties',
            'cropId',
            'enum',
          ),
        );
      const crop = crops.find((item) => item.id === ids[0]);
      assert.ok(crop);
      return crop;
    };
    fakeModel(adapter, async (request) => {
      const crop = cropFor(request);
      assert.equal(request.reasoning_effort, 'high');
      assert.equal(request.max_completion_tokens, 10000);
      if (crop.role === 'combined') {
        assert.equal(active, 0);
        assert.equal(usage, 6);
        assert.match(request.messages[1]?.content ?? '', /"part":"PART II: SINGLE CORRECT"/);
        assert.match(
          request.messages[1]?.content ?? '',
          /"topic":"Section \(C\): Nitrogen compounds"/,
        );
      } else {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          gates.push({ id: crop.id, release: resolve });
          if (gates.length === 3) {
            const wave = gates;
            gates = [];
            queueMicrotask(() => {
              for (const gate of [...wave].reverse()) gate.release();
            });
          }
        });
        active -= 1;
      }
      completed.push(crop.id);
      return batchResponse([crop], [itemsFor(crop)]);
    });
    const input = {
      crops,
      pageCount: 6,
      context,
      onUsage: async () => {
        usage += 1;
      },
    };
    const result = DetectedStructureSchema.parse(await adapter.extract(input));
    assert.equal(peak, 3);
    assert.deepEqual(completed.slice(0, 3), ['phenol', 'part-i', 'exercise']);
    assert.deepEqual(completed.slice(3, 6), ['nitrogen', 'part-ii', 'amines']);
    assert.deepEqual(
      result.cropResults?.map((crop) => crop.cropId),
      crops.map((crop) => crop.id),
    );
    assert.deepEqual(result.warnings, []);
    assert.equal(usage, crops.length);
    assert.deepEqual(
      result.nodes.map((node) => node.label),
      ['Exercise-1', 'Exercise-2'],
    );
    assert.deepEqual(
      result.nodes[0]?.children[0]?.children.map((node) => [node.label, node.questionType]),
      [
        ['Phenol', 'subjective'],
        ['Amines', 'subjective'],
      ],
    );
    assert.equal(result.nodes[0].children[1]?.children[0]?.label, 'Nitrogen compounds');
    assert.equal(result.nodes[0].children[1].children[0].questionType, 'single_correct');
    assert.ok(
      result.nodes[1]?.children[0]?.children.every((node) => node.questionType === 'integer'),
    );

    fakeModel(adapter, () => {
      throw new Error('A saved crop must not call AI again');
    });
    const savedCrops = result.cropResults ?? [];
    const reused = DetectedStructureSchema.parse(await adapter.extract({ ...input, savedCrops }));
    assert.equal(reused.aiCallCount, 0);
    assert.deepEqual(reused.nodes, result.nodes);
    assert.equal(adapter.estimate({ ...input, savedCrops }).callCount, 0);
    const edited = crops.map((crop) =>
      crop.id === 'nitrogen' ? { ...crop, text: 'Section (C): Nitrogen reactions' } : crop,
    );
    let calls = 0;
    fakeModel(adapter, (request) => {
      calls += 1;
      assert.equal(cropFor(request).id, 'nitrogen');
      const changed = edited.find((crop) => crop.id === 'nitrogen');
      assert.ok(changed);
      return batchResponse([changed], [itemsFor(changed)]);
    });
    const changed = DetectedStructureSchema.parse(
      await adapter.extract({ ...input, crops: edited, savedCrops }),
    );
    assert.equal(calls, 1);
    assert.equal(changed.aiCallCount, 1);
    assert.equal(adapter.estimate({ ...input, crops: edited, savedCrops }).callCount, 1);
    assert.equal(changed.nodes[0]?.children[1]?.children[0]?.label, 'Nitrogen reactions');
  },
);

void test('typed groups record all usage before the next budget check and stop further dispatches', async () => {
  const crops: StructureTextCrop[] = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    pageNumber: index + 1,
    role: 'section',
    text: `Exercise-${String(index + 1)}`,
  }));
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  let checks = 0;
  let usage = 0;
  fakeModel(adapter, () => {
    const crop = crops[calls++];
    assert.ok(crop);
    return batchResponse([crop], [[{ section: crop.text, part: null, topic: null }]]);
  });
  const result = DetectedStructureSchema.parse(
    await adapter.extract({
      crops,
      pageCount: 5,
      context,
      beforeBatch: async () => {
        if (++checks === 4) {
          assert.equal(usage, 3);
          throw new Error('Budget exceeded');
        }
      },
      onUsage: async () => {
        usage += 1;
      },
    }),
  );
  assert.equal(calls, 3);
  assert.equal(checks, 4);
  assert.equal(result.aiCallCount, 3);
  assert.equal(result.nodes.length, 3);
  assert.match((result.warnings ?? []).join(' '), /Budget exceeded/);
});

void test('a failed typed request drains and bills its completed siblings without starting another group', async () => {
  const crops: StructureTextCrop[] = Array.from({ length: 4 }, (_, index) => ({
    id: String(index),
    pageNumber: index + 1,
    role: 'section',
    text: `Exercise-${String(index + 1)}`,
  }));
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  let usage = 0;
  fakeModel(adapter, () => {
    const crop = crops[calls++];
    assert.ok(crop);
    if (crop.id === '1') throw new Error('Request failed');
    return batchResponse([crop], [[{ section: crop.text, part: null, topic: null }]]);
  });
  const result = DetectedStructureSchema.parse(
    await adapter.extract({
      crops,
      pageCount: 4,
      context,
      onUsage: async () => {
        usage += 1;
      },
    }),
  );
  assert.equal(calls, 3);
  assert.equal(usage, 2);
  assert.equal(result.aiCallCount, 3);
  assert.deepEqual(
    result.cropResults?.map((crop) => crop.cropId),
    ['0', '2'],
  );
  assert.match((result.warnings ?? []).join(' '), /failed or timed out/);
});

void test('a typed crop rejects wrong-level and fabricated fields without losing its existing parents', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'Exercise-1\nPART I', [{ section: 'Exercise-1', part: 'PART I', topic: null }]);
  const text = 'Section (G): Magnetic force on a charge (oblique incidence)';
  acc.accept(
    2,
    {
      items: [
        {
          section: 'Invented section',
          part: 'Invented part',
          topic: { printed: text, label: 'Invented topic' },
        },
      ],
    },
    structureHeadingCandidates([text], null, true, 'topic'),
    [],
    'topic',
  );
  assert.equal(acc.result().nodes[0]?.label, 'Exercise-1');
  assert.equal(acc.result().nodes[0]?.children[0]?.label, 'I');
  assert.equal(
    acc.result().nodes[0]?.children[0]?.children[0]?.label,
    'Magnetic force on a charge (oblique incidence)',
  );
  assert.match(acc.result().warnings.join(' '), /operator-selected topic crop/);
});

void test('changing a crop role invalidates saved extraction and its cost estimate even with identical OCR', async () => {
  const crop: StructureTextCrop = {
    id: 'role',
    pageNumber: 1,
    text: 'Section (A): Phenol',
    role: 'section',
  };
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () =>
    batchResponse([crop], [[{ section: crop.text, part: null, topic: null }]]),
  );
  const input = { crops: [crop], context, pageCount: 1, onUsage: async () => {} };
  const initial = DetectedStructureSchema.parse(await adapter.extract(input));
  const savedCrops = initial.cropResults ?? [];
  const changed = { ...crop, role: 'topic' as const };
  assert.equal(adapter.estimate({ ...input, crops: [changed], savedCrops }).callCount, 1);
  fakeModel(adapter, () =>
    batchResponse([changed], [[{ section: null, part: null, topic: changed.text }]]),
  );
  const result = DetectedStructureSchema.parse(
    await adapter.extract({ ...input, crops: [changed], savedCrops }),
  );
  assert.equal(result.aiCallCount, 1);
  assert.equal(result.nodes[0]?.level, 'topic');
  assert.equal(result.nodes[0].label, 'Phenol');
});

void test('saved per-crop results build the ordered hierarchy without extra AI calls', async () => {
  const crops = [
    {
      id: 'first',
      pageNumber: 1,
      text: 'Exercise-1\nPART I: SUBJECTIVE QUESTIONS\nSection (A): Phenol',
    },
    { id: 'second', pageNumber: 2, text: 'PART II: SINGLE CORRECT\nSection (B): Amines' },
  ];
  const items: StructurePageObservation['items'][] = [
    [
      {
        section: 'Exercise-1',
        part: 'PART I: SUBJECTIVE QUESTIONS',
        topic: 'Section (A): Phenol',
        questionType: {
          value: 'subjective',
          printed: 'PART I: SUBJECTIVE QUESTIONS',
          level: 'part',
        },
      },
    ],
    [
      {
        section: null,
        part: 'PART II: SINGLE CORRECT',
        topic: 'Section (B): Amines',
        questionType: {
          value: 'single_correct',
          printed: 'PART II: SINGLE CORRECT',
          level: 'part',
        },
      },
    ],
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, () => {
    const index = calls++;
    return batchResponse(crops.slice(index, index + 1), items.slice(index, index + 1));
  });
  const input = { crops, pageCount: 2, context, onUsage: async () => {} };
  const initial = DetectedStructureSchema.parse(await adapter.extract(input));
  assert.equal(calls, 2);
  assert.equal(initial.cropResults?.length, 2);
  const savedCrops = initial.cropResults ?? [];
  fakeModel(adapter, () => {
    throw new Error('Cached crops must not call AI');
  });
  const reused = DetectedStructureSchema.parse(await adapter.extract({ ...input, savedCrops }));
  assert.equal(reused.aiCallCount, 0);
  assert.deepEqual(reused.nodes, initial.nodes);
  assert.equal(reused.nodes[0]?.children[1]?.children[0]?.questionType, 'single_correct');
  assert.equal(adapter.estimate({ crops, savedCrops, pageCount: 2, context }).callCount, 0);
  assert.equal(adapter.estimate({ crops, savedCrops, pageCount: 2, context }).costUsd?.max, 0);
});

void test('changing OCR, manual context or source rules invalidates a saved AI crop', async () => {
  const crop = { id: 'one', pageNumber: 1, text: 'Exercise-1' };
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, () => {
    calls++;
    return batchResponse([crop], [[{ section: 'Exercise-1', part: null, topic: null }]]);
  });
  const base = { crops: [crop], context, pageCount: 1, rule: savedRule, onUsage: async () => {} };
  const initial = DetectedStructureSchema.parse(await adapter.extract(base));
  const savedCrops = initial.cropResults ?? [];
  await adapter.extract({ ...base, savedCrops, context: { ...context, module: 'Allen' } });
  await adapter.extract({
    ...base,
    savedCrops,
    rule: { ...savedRule, notes: 'Changed recognition notes' },
  });
  await adapter.extract({ ...base, savedCrops, crops: [{ ...crop, text: 'Exercise-1\nPART I' }] });
  assert.equal(calls, 4);
});

void test('saved crop values are rechecked against OCR and cannot supply a fabricated Topic', async () => {
  const crop = { id: 'one', pageNumber: 1, text: 'Exercise-1\nPART I\nSection (A): Phenol' };
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () =>
    batchResponse(
      [crop],
      [[{ section: 'Exercise-1', part: 'PART I', topic: 'Section (A): Phenol' }]],
    ),
  );
  const base = { crops: [crop], context, pageCount: 1, onUsage: async () => {} };
  const initial = DetectedStructureSchema.parse(await adapter.extract(base));
  const savedCrops = initial.cropResults ?? [];
  const saved = savedCrops[0]?.items[0];
  assert.ok(saved);
  saved.topic = { printed: 'Section (A): Phenol', label: 'Invented topic' };
  fakeModel(adapter, () => {
    throw new Error('No model call is needed to reject fabricated values');
  });
  const result = DetectedStructureSchema.parse(await adapter.extract({ ...base, savedCrops }));
  assert.equal(result.cropResults?.[0]?.items[0]?.topic?.label, 'Phenol');
  assert.ok(result.warnings?.some((warning) => warning.includes('rejected a cleaned topic label')));
});

void test('structure input preserves the manual class and accepts older context without it', () => {
  const request = { crops: textCrops, context: { ...context, className: '12' }, pageCount: 1 };
  assert.equal(DetectStructureRequestSchema.parse(request).context.className, '12');
  const legacyContext = { ...context };
  Reflect.deleteProperty(legacyContext, 'className');
  assert.equal(
    DetectStructureRequestSchema.parse({ ...request, context: legacyContext }).context.className,
    '',
  );
  assert.equal(StructureEstimateRequestSchema.parse(request).context.className, '12');
});

void test('crop preview permits only one crop and rejects duplicate saved crop IDs', () => {
  assert.equal(
    DetectStructureRequestSchema.safeParse({
      crops: [...textCrops, { id: 'second', pageNumber: 2, text: 'PART II' }],
      context,
      pageCount: 2,
      cropOnly: true,
    }).success,
    false,
  );
  assert.equal(
    DetectStructureRequestSchema.safeParse({
      crops: textCrops.slice(0, 1),
      context,
      pageCount: 2,
      cropOnly: true,
    }).success,
    true,
  );
  const saved = { cropId: 'a', text: 'Exercise-1', contextKey: 'x', items: [] };
  assert.equal(
    DetectStructureRequestSchema.safeParse({
      crops: textCrops,
      context,
      pageCount: 2,
      savedCrops: [saved, saved],
    }).success,
    false,
  );
});

void test('crop preview returns an empty result for instruction-only text while tree generation still requires headings', async () => {
  const crop = {
    id: 'instruction',
    pageNumber: 1,
    text: 'Marked questions are recommended for revision.',
  };
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () => batchResponse([crop], [[]]));
  const unused = new Proxy(
    {},
    {
      get: () => {
        throw new Error('Unexpected dependency');
      },
    },
  );
  const service = new IngestionService(
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    adapter,
    { assertWithinLimit: async () => {}, recordUsage: async () => {} } as never,
    { resolveContext: async () => null },
    emptyOcr,
    70,
  );
  const input = { crops: [crop], context, pageCount: 1 };
  const preview = await service.detectStructure({ ...input, cropOnly: true });
  assert.deepEqual(preview.nodes, []);
  assert.deepEqual(preview.cropResults?.[0]?.items, []);
  assert.equal(preview.usage?.callCount, 1);
  await assert.rejects(service.detectStructure(input), /heading|marker/i);
});

void test('reviewed OCR spacing changes do not duplicate a repeated Topic across crops', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'PART I\nSection(A): Polymers', [
    { section: null, part: 'PART I', topic: 'Section(A): Polymers', questionType: null },
  ]);
  readText(acc, 1, 'Section (A): Polymers', [
    { section: null, part: null, topic: 'Section (A): Polymers', questionType: null },
  ]);
  readText(acc, 2, 'Section (B): Polymers', [
    { section: null, part: null, topic: 'Section (B): Polymers', questionType: null },
  ]);
  assert.deepEqual(
    acc.result().nodes[0]?.children.map((node) => node.label),
    ['Polymers', 'Polymers'],
  );
  assert.deepEqual(acc.result().warnings, []);
});

void test('explicit OCR categories map to the controlled vocabulary; generic and mixed labels stay unknown', () => {
  const labels = [
    'Single Correct Questions',
    'One or more options are correct',
    'Numerical Value Questions',
    'Matrix Match',
    'Passage-based Questions',
    'Assertion and Reason',
    'True / False',
    'Fill in the blanks',
    'PART I: SUBJECTIVE QUESTIONS',
  ];
  assert.deepEqual(
    structureQuestionTypeEvidence(labels).map((item) => item.value),
    [...KNOWN_QUESTION_TYPES],
  );
  assert.deepEqual(
    structureQuestionTypeEvidence([
      'Objective Questions',
      'MCQ',
      'Multiple Choice Questions',
      'Single Correct and Multiple Correct Questions',
    ]),
    [],
  );
  assert.equal(
    structureQuestionTypeEvidence(['Multiple Choice (Single Correct)'])[0]?.value,
    'single_correct',
  );
});

void test('type schema constrains categories and printed evidence, including null when no label exists', () => {
  const evidence = structureQuestionTypeEvidence(['PART I: SUBJECTIVE QUESTIONS']);
  const schema = structureJsonSchema(null, undefined, ['a'], evidence);
  const type = jsonAt(
    schema,
    'properties',
    'crops',
    'items',
    'properties',
    'items',
    'items',
    'properties',
    'questionType',
  );
  assert.deepEqual(jsonAt(type, 'anyOf', '0', 'required'), ['value', 'printed', 'level']);
  assert.deepEqual(jsonAt(type, 'anyOf', '0', 'properties', 'value', 'enum'), ['subjective']);
  assert.deepEqual(jsonAt(type, 'anyOf', '0', 'properties', 'printed', 'enum'), [
    'PART I: SUBJECTIVE QUESTIONS',
  ]);
  const empty = structureJsonSchema(null, undefined, ['a'], []);
  assert.deepEqual(
    jsonAt(
      empty,
      'properties',
      'crops',
      'items',
      'properties',
      'items',
      'items',
      'properties',
      'questionType',
    ),
    {
      type: 'null',
    },
  );
  assert.match(structurePrompt(context, []), /"Objective Questions" or "MCQ" alone/);
});

void test('Part types reach Topic leaves, continue on later pages, and clear on new Part and Exercise', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'Exercise-1\nPART I: SUBJECTIVE QUESTIONS\nSection (A): Polymers', [
    {
      section: 'Exercise-1',
      part: 'PART I: SUBJECTIVE QUESTIONS',
      topic: 'Section (A): Polymers',
      questionType: { value: 'subjective', printed: 'PART I: SUBJECTIVE QUESTIONS', level: 'part' },
    },
  ]);
  readText(acc, 2, 'Section (B): Biomolecules', [
    { section: null, part: null, topic: 'Section (B): Biomolecules', questionType: null },
  ]);
  readText(acc, 3, 'PART II: OBJECTIVE QUESTIONS\nSection (C): Chemical Bonding', [
    {
      section: null,
      part: 'PART II: OBJECTIVE QUESTIONS',
      topic: 'Section (C): Chemical Bonding',
      questionType: null,
    },
  ]);
  readText(acc, 4, 'PART III: SINGLE CORRECT\nSection (D): Atomic Structure', [
    {
      section: null,
      part: 'PART III: SINGLE CORRECT',
      topic: 'Section (D): Atomic Structure',
      questionType: { value: 'single_correct', printed: 'PART III: SINGLE CORRECT', level: 'part' },
    },
  ]);
  readText(acc, 5, 'Exercise-2\nSection (A): Kinetics', [
    { section: 'Exercise-2', part: null, topic: 'Section (A): Kinetics', questionType: null },
  ]);
  const result = acc.result();
  assert.deepEqual(
    result.nodes[0]?.children.map((part) => part.children.map((topic) => topic.questionType)),
    [['subjective', 'subjective'], [''], ['single_correct']],
  );
  assert.equal(result.nodes[1]?.children[0]?.questionType, '');
  assert.ok(result.nodes.every((node) => node.questionType === ''));
  assert.ok(result.nodes[0].children.every((part) => part.questionType === ''));
  assert.deepEqual(result.nodes[0].children[0]?.children[0]?.pages, {
    question: [],
    answer: [],
    solution: null,
  });
  assert.deepEqual(result.warnings, []);
});

void test('Topic override does not change its siblings; unnamed Topic inherits its parent type', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'Exercise-1: SINGLE CORRECT\nPART I', [
    {
      section: 'Exercise-1: SINGLE CORRECT',
      part: 'PART I',
      topic: null,
      questionType: {
        value: 'single_correct',
        printed: 'Exercise-1: SINGLE CORRECT',
        level: 'section',
      },
    },
  ]);
  assert.equal(acc.result().nodes[0]?.children[0]?.questionType, 'single_correct');
  assert.deepEqual(acc.result().nodes[0]?.children[0]?.children, []);
  readText(acc, 2, 'Section (A): Polymers\nMultiple Correct Questions', [
    {
      section: null,
      part: null,
      topic: 'Section (A): Polymers',
      questionType: {
        value: 'multi_correct',
        printed: 'Multiple Correct Questions',
        level: 'topic',
      },
    },
  ]);
  readText(acc, 3, 'Section (B): Biomolecules', [
    { section: null, part: null, topic: 'Section (B): Biomolecules', questionType: null },
  ]);
  readText(acc, 4, 'PART II\nSection (C)', [
    { section: null, part: 'PART II', topic: 'Section (C)', questionType: null },
  ]);
  const parts = acc.result().nodes[0]?.children;
  assert.deepEqual(
    parts?.[0]?.children.map((node) => node.questionType),
    ['multi_correct', 'single_correct'],
  );
  assert.equal(parts[1]?.children[0]?.label, '');
  assert.equal(parts[1].children[0].questionType, 'single_correct');
});

void test('type-only crops update the current scope without inventing a heading; conflicts warn', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'Single Correct Questions', [
    {
      section: null,
      part: null,
      topic: null,
      questionType: {
        value: 'single_correct',
        printed: 'Single Correct Questions',
        level: 'topic',
      },
    },
  ]);
  assert.equal(acc.result().nodes.length, 0);
  readText(acc, 2, 'PART I\nSection (A): Polymers', [
    { section: null, part: 'PART I', topic: 'Section (A): Polymers', questionType: null },
  ]);
  readText(acc, 3, 'Single Correct Questions', [
    {
      section: null,
      part: null,
      topic: null,
      questionType: {
        value: 'single_correct',
        printed: 'Single Correct Questions',
        level: 'topic',
      },
    },
  ]);
  readText(acc, 4, 'Multiple Correct Questions', [
    {
      section: null,
      part: null,
      topic: null,
      questionType: {
        value: 'multi_correct',
        printed: 'Multiple Correct Questions',
        level: 'topic',
      },
    },
  ]);
  assert.equal(acc.result().nodes[0]?.children[0]?.questionType, 'single_correct');
  assert.ok(
    acc.result().warnings.some((warning) => warning.includes('conflicting question types')),
  );
  acc.failedPage(5, 'Unreadable crop');
  readText(acc, 6, 'Section (B): Biomolecules', [
    { section: null, part: null, topic: 'Section (B): Biomolecules', questionType: null },
  ]);
  assert.equal(acc.result().nodes[1]?.questionType, '');
});

void test('fabricated type, mismatched category and wrong heading scope cannot populate JSON', () => {
  for (const questionType of [
    {
      value: 'single_correct' as const,
      printed: 'Single Correct Questions',
      level: 'part' as const,
    },
    {
      value: 'single_correct' as const,
      printed: 'PART I: SUBJECTIVE QUESTIONS',
      level: 'part' as const,
    },
    {
      value: 'subjective' as const,
      printed: 'PART I: SUBJECTIVE QUESTIONS',
      level: 'topic' as const,
    },
  ]) {
    const acc = new StructurePageAccumulator(
      { ...context, questionType: 'single_correct' },
      savedRule,
    );
    readText(acc, 1, 'PART I: SUBJECTIVE QUESTIONS\nSection (A): Polymers', [
      {
        section: null,
        part: 'PART I: SUBJECTIVE QUESTIONS',
        topic: 'Section (A): Polymers',
        questionType,
      },
    ]);
    assert.equal(acc.result().nodes[0]?.children[0]?.questionType, '');
    assert.ok(acc.result().warnings.some((warning) => warning.includes('rejected question type')));
  }
});

void test('a typed Part heading must be returned before its type can update the current scope', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'PART I\nSection (A): Polymers', [
    { section: null, part: 'PART I', topic: 'Section (A): Polymers', questionType: null },
  ]);
  readText(acc, 2, 'PART II: SUBJECTIVE QUESTIONS', [
    {
      section: null,
      part: null,
      topic: null,
      questionType: {
        value: 'subjective',
        printed: 'PART II: SUBJECTIVE QUESTIONS',
        level: 'part',
      },
    },
  ]);
  assert.equal(acc.result().nodes[0]?.children[0]?.questionType, '');
  assert.ok(acc.result().warnings.some((warning) => warning.includes('rejected question type')));
});

void test('custom heading output labels preserve the separately detected question type', () => {
  const acc = new StructurePageAccumulator(context, customRule);
  const text = 'Practice Sheet-2\nLevel 3: Subjective Questions\nBlock C: Biomolecules';
  acc.accept(
    1,
    {
      items: [
        {
          section: { printed: 'Practice Sheet-2', label: 'Practice Sheet-2' },
          part: { printed: 'Level 3: Subjective Questions', label: '3' },
          topic: { printed: 'Block C: Biomolecules', label: 'Biomolecules' },
          questionType: {
            value: 'subjective',
            printed: 'Level 3: Subjective Questions',
            level: 'part',
          },
        },
      ],
    },
    structureHeadingCandidates(text.split('\n'), customRule, true),
    structureQuestionTypeEvidence(text.split('\n')),
  );
  assert.equal(acc.result().nodes[0]?.children[0]?.label, '3');
  assert.equal(acc.result().nodes[0]?.children[0]?.children[0]?.questionType, 'subjective');
  assert.deepEqual(acc.result().warnings, []);
});

void test('one-crop AI calls carry type scopes and ground evidence in the current crop', async () => {
  const crops: StructureTextCrop[] = [
    {
      id: 'a',
      pageNumber: 1,
      text: 'Exercise-1\nPART I: SUBJECTIVE QUESTIONS\nSection (A): Polymers',
    },
    ...Array.from({ length: 11 }, (_, index) => ({
      id: `continued-${String(index)}`,
      pageNumber: index + 2,
      text: 'Section (A): Polymers',
    })),
    { id: 'b', pageNumber: 13, text: 'Section (B): Biomolecules' },
    { id: 'c', pageNumber: 14, text: 'PART II: OBJECTIVE QUESTIONS\nSection (C): Kinetics' },
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, (request) => {
    calls += 1;
    const batch = crops.slice(calls - 1, calls);
    const schema = request.response_format.json_schema.schema;
    assert.deepEqual(
      jsonAt(schema, 'properties', 'crops', 'items', 'properties', 'cropId', 'enum'),
      [batch[0]?.id],
    );
    assert.equal(request.reasoning_effort, 'high');
    assert.equal(request.max_completion_tokens, 10000);
    const prompt = request.messages[1]?.content ?? '';
    assert.match(prompt, /questionTypeEvidence/);
    if (calls > 1) assert.match(prompt, /"part":"subjective"/);
    return batchResponse(
      batch,
      batch.map((crop) => [
        {
          section: crop.id === 'a' ? 'Exercise-1' : null,
          part:
            crop.id === 'a'
              ? 'PART I: SUBJECTIVE QUESTIONS'
              : crop.id === 'c'
                ? 'PART II: OBJECTIVE QUESTIONS'
                : null,
          topic:
            crop.id === 'b'
              ? 'Section (B): Biomolecules'
              : crop.id === 'c'
                ? 'Section (C): Kinetics'
                : 'Section (A): Polymers',
          questionType:
            crop.id === 'a'
              ? { value: 'subjective', printed: 'PART I: SUBJECTIVE QUESTIONS', level: 'part' }
              : crop.id === 'c' // Simulate the model copying another crop's evidence: code rejects it.
                ? { value: 'subjective', printed: 'PART I: SUBJECTIVE QUESTIONS', level: 'part' }
                : null,
        },
      ]),
    );
  });
  const result = validateStructure(
    await adapter.extract({ crops, pageCount: 14, context, onUsage: async () => {} }),
    14,
    'separate',
  );
  assert.equal(calls, 14);
  assert.equal(adapter.estimate({ crops, pageCount: 14, context }).callCount, 14);
  assert.deepEqual(
    result.nodes[0]?.children.map((part) => part.children.map((topic) => topic.questionType)),
    [['subjective', 'subjective'], ['']],
  );
  assert.ok(result.warnings.some((warning) => warning.includes('rejected question type')));
});

void test('collects printed hierarchy and keeps every page slot manual', () => {
  const acc = new StructurePageAccumulator(context);
  read(
    acc,
    1,
    observation({
      section: 'Exercise-1',
      part: 'PART I: SUBJECTIVE QUESTIONS',
      topic: 'Section (A): Elements',
    }),
  );
  read(acc, 2, { items: [] });
  read(acc, 3, observation({ part: null, topic: 'Section (B): Physical Properties' }));
  read(acc, 4, observation({ part: 'II', topic: null }));
  read(
    acc,
    5,
    observation({ section: 'Exercise-1', part: 'PART I', topic: 'Section (A): Elements' }),
  );
  const result = validateStructure(acc.result(), 5, 'separate');
  const parts = result.nodes[0]?.children;
  assert.equal(parts?.length, 2);
  assert.equal(parts[0]?.label, 'I');
  assert.deepEqual(
    parts[0].children.map((n) => n.label),
    ['Elements', 'Physical Properties'],
  );
  assert.deepEqual(parts[1]?.children, []);
  const check = (nodes: DetectedStructureNode[]) => {
    for (const node of nodes) {
      assert.deepEqual(node.pages, { question: [], answer: [], solution: null });
      check(node.children);
    }
  };
  check(result.nodes);
  assert.deepEqual(result.warnings, []);
});

void test('question pages follow chronological crop positions, lowest children and cached rebuilds without extra AI calls', async () => {
  const crops: StructureTextCrop[] = [
    { id: 'exercise-2', pageNumber: 9, role: 'section', text: 'Exercise-2' },
    { id: 'exercise-1', pageNumber: 1, role: 'section', text: 'Exercise-1' },
    { id: 'part-i', pageNumber: 1, role: 'part', text: 'PART I: SUBJECTIVE QUESTIONS' },
    { id: 'phenol', pageNumber: 1, role: 'topic', text: 'Section (A): Phenol' },
    { id: 'part-ii', pageNumber: 7, role: 'part', text: 'PART II: INTEGER TYPE' },
    { id: 'amines', pageNumber: 4, role: 'topic', text: 'Section (B): Amines' },
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, (request) => {
    calls += 1;
    assert.doesNotMatch(JSON.stringify(request.response_format.json_schema.schema), /"pages"/);
    const ids = z
      .array(z.string())
      .parse(
        jsonAt(
          request.response_format.json_schema.schema,
          'properties',
          'crops',
          'items',
          'properties',
          'cropId',
          'enum',
        ),
      );
    const crop = crops.find((item) => item.id === ids[0]);
    assert.ok(crop && crop.role);
    const label =
      crop.role === 'part'
        ? partNameFromHeading(crop.text)
        : crop.role === 'topic'
          ? topicNameFromHeading(crop.text)
          : crop.text;
    const heading = { printed: crop.text, label };
    const type = structureQuestionTypeEvidence(crop.text.split('\n'))[0];
    return batchResponse(
      [crop],
      [
        [
          {
            section: crop.role === 'section' ? heading : null,
            part: crop.role === 'part' ? heading : null,
            topic: crop.role === 'topic' ? heading : null,
            questionType: type ? { ...type, level: crop.role } : null,
          },
        ],
      ],
    );
  });
  const input = {
    crops,
    pageCount: 11,
    context,
    assignQuestionPages: true,
    onUsage: async () => {},
  };
  const initial = DetectedStructureSchema.parse(await adapter.extract(input));
  const checked = validateStructure(initial, 11, 'separate', null, { allowQuestionPages: true });
  assert.deepEqual(
    checked.nodes[0]?.children[0]?.children.map((node) => node.pages.question),
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
  );
  assert.deepEqual(checked.nodes[0].children[1]?.pages, {
    question: [7, 8],
    answer: [],
    solution: null,
  });
  assert.deepEqual(checked.nodes[1]?.pages.question, [9, 10, 11]);
  assert.deepEqual(checked.nodes[0].pages.question, []);
  assert.deepEqual(checked.nodes[0].children[0].pages.question, []);
  assert.equal(calls, crops.length);
  assert.deepEqual(checked.warnings, []);

  fakeModel(adapter, () => {
    throw new Error('Page assignment must reuse saved heading results');
  });
  const savedCrops = initial.cropResults ?? [];
  const cached = DetectedStructureSchema.parse(await adapter.extract({ ...input, savedCrops }));
  assert.equal(cached.aiCallCount, 0);
  assert.deepEqual(cached.nodes, initial.nodes);
  const extended = DetectedStructureSchema.parse(
    await adapter.extract({ ...input, savedCrops, pageCount: 13 }),
  );
  assert.equal(extended.aiCallCount, 0);
  assert.deepEqual(extended.nodes[1]?.pages.question, [9, 10, 11, 12, 13]);
});

void test('custom hierarchy leaves receive question pages and parent changes stop preceding ranges', () => {
  const acc = new StructurePageAccumulator(context, fourLevelRule);
  for (const [page, role, text, label] of [
    [1, 'section', 'Exercise-1', 'Exercise-1'],
    [1, 'part', 'PART I: SUBJECTIVE QUESTIONS', 'I'],
    [1, 'subpart', 'Subpart A', 'A'],
    [1, 'topic', 'Section (A): Phenol', 'Phenol'],
    [3, 'topic', 'Section (B): Amines', 'Amines'],
    [5, 'subpart', 'Subpart B', 'B'],
    [7, 'part', 'PART II: SINGLE CORRECT', 'II'],
    [9, 'section', 'Exercise-2', 'Exercise-2'],
  ] as const) {
    acc.accept(
      page,
      { items: [{ headings: { [role]: { printed: text, label } }, questionType: null }] },
      structureHeadingCandidates([text], fourLevelRule, true, role),
      [],
      role,
    );
  }
  const result = validateStructure(acc.result(10), 10, 'separate', fourLevelRule, {
    allowQuestionPages: true,
  });
  assert.deepEqual(
    result.nodes[0]?.children[0]?.children[0]?.children.map((node) => node.pages.question),
    [
      [1, 2],
      [3, 4],
    ],
  );
  assert.deepEqual(result.nodes[0].children[0].children[1]?.pages.question, [5, 6]);
  assert.deepEqual(result.nodes[0].children[1]?.pages.question, [7, 8]);
  assert.deepEqual(result.nodes[1]?.pages.question, [9, 10]);
  assert.deepEqual(result.warnings, []);
});

void test('repeated headings retain their leaf identity and question page lists contain no duplicate pages', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, observation({ section: 'Exercise-1', topic: 'Section (A): Phenol' }));
  read(acc, 3, observation({ part: null, topic: 'Section (B): Amines' }));
  read(acc, 5, observation({ section: 'Exercise-1', topic: 'Section (A): Phenol' }));
  const result = validateStructure(acc.result(6), 6, 'inline', null, { allowQuestionPages: true });
  assert.deepEqual(
    result.nodes[0]?.children[0]?.children.map((node) => node.pages.question),
    [
      [1, 2, 5, 6],
      [3, 4],
    ],
  );
  assert.equal(result.nodes[0].children[0].children.length, 2);
});

void test('failed headings and pages before the first final child stay unassigned instead of bleeding into the prior leaf', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, observation({ section: 'Exercise-1', topic: 'Section (A): Phenol' }));
  acc.failedPage(3, 'Heading request failed');
  read(acc, 3, observation({ topic: 'Section (B): Amines' }));
  read(acc, 6, observation({ section: 'Exercise-2', topic: 'Section (A): Polymers' }));
  const result = acc.result(8);
  assert.deepEqual(result.nodes[0]?.children[0]?.children[0]?.pages.question, [1, 2]);
  assert.ok(
    result.warnings.some((warning) => warning.includes('Question pages left unassigned: 3, 4, 5')),
  );
  assert.deepEqual(result.nodes.at(-1)?.children[0]?.children[0]?.pages.question, [6, 7, 8]);
  const startsLate = new StructurePageAccumulator(context);
  read(startsLate, 1, observation({ section: 'Exercise-1' }));
  read(startsLate, 3, observation({ part: null, topic: 'Section (A): Phenol' }));
  assert.deepEqual(
    startsLate.result(5).nodes[0]?.children[0]?.children[0]?.pages.question,
    [3, 4, 5],
  );
  assert.match(startsLate.result(5).warnings.join(' '), /left unassigned: 1, 2/);
});

void test('validation permits only unique in-range question pages on final children; supporting pages stay manual', () => {
  const options = { allowQuestionPages: true };
  assert.throws(
    () =>
      validateStructure(
        { nodes: [leaf({ pages: { question: [1], answer: [2] } })] },
        3,
        'separate',
        null,
        options,
      ),
    /page assignments are disabled/,
  );
  assert.throws(
    () =>
      validateStructure(
        { nodes: [leaf({ pages: { question: [4] } })] },
        3,
        'separate',
        null,
        options,
      ),
    /within the current PDF/,
  );
  assert.throws(
    () =>
      validateStructure(
        {
          nodes: [
            leaf({ pages: { question: [1] } }),
            leaf({ label: '2', pages: { question: [1] } }),
          ],
        },
        3,
        'separate',
        null,
        options,
      ),
    /unique assignments/,
  );
  assert.throws(
    () =>
      validateStructure(
        {
          nodes: [
            leaf({
              pages: { question: [1] },
              children: [leaf({ level: 'topic', label: 'Phenol' })],
            }),
          ],
        },
        3,
        'separate',
        null,
        options,
      ),
    /final child/,
  );
});

void test('Part labels exclude PART and question-type descriptions', () => {
  for (const [printed, expected] of [
    ['PART I: SUBJECTIVE QUESTIONS', 'I'],
    ['Part - 2 : Objective Questions', '2'],
    ['PART (III) — MULTIPLE CORRECT', 'III'],
    ['1: Subjective', '1'],
    ['II', 'II'],
  ])
    assert.equal(partNameFromHeading(printed ?? ''), expected);
});

void test('Topic labels remove Section markers including compound and subscript identifiers', () => {
  for (const printed of [
    'Section (A): Polymers',
    'Section (A₁ + A₂): Polymers',
    'Section (A1+A2) : Polymers',
    'SECTION-A: Polymers',
    'Section B Polymers',
    'Topic 2: Polymers',
    'Topic: Polymers',
  ])
    assert.equal(topicNameFromHeading(printed), 'Polymers');
  for (const printed of ['Section (A)', 'Topic 2', 'Section:'])
    assert.equal(topicNameFromHeading(printed), '');
  for (const printed of [
    'Sectional Properties',
    'Elements: Occurrence & Isolation',
    'Comprehension # 1',
  ])
    assert.equal(topicNameFromHeading(printed), printed);
});

void test('validation cleans labels for JSON independently of the model prompt', () => {
  const result = validateStructure(
    {
      nodes: [
        leaf({
          label: 'PART I: SUBJECTIVE QUESTIONS',
          children: [leaf({ level: 'topic', label: 'Section (A₁+A₂): Polymers' })],
        }),
      ],
    },
    2,
    'separate',
  );
  assert.equal(result.nodes[0]?.label, 'I');
  assert.equal(result.nodes[0].children[0]?.label, 'Polymers');
});

void test('absent Topics are omitted; printed unnamed Topics stay blank instead of using the chapter name', () => {
  for (const topic of [null, 'Section (A)', 'Topic 2']) {
    const acc = new StructurePageAccumulator(context);
    read(acc, 1, observation({ section: 'Exercise-1', topic }));
    const part = acc.result().nodes[0]?.children[0];
    assert.ok(part);
    if (topic === null) assert.deepEqual(part.children, []);
    else assert.equal(part.children[0]?.label, '');
  }
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, { items: [] });
  assert.deepEqual(acc.result().nodes, []);
});

void test('new Parts and Exercises do not inherit the preceding topic name', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, observation({ section: 'Exercise-1', topic: 'Section (A): Polymers' }));
  read(acc, 2, observation({ part: 'II' }));
  read(acc, 3, observation({ section: 'Exercise-2', part: 'I' }));
  assert.deepEqual(acc.result().nodes[0]?.children[1]?.children, []);
  assert.deepEqual(acc.result().nodes[1]?.children[0]?.children, []);
});

void test('Exercise-2 without Topics keeps typed Parts as final nodes with manual page slots', () => {
  const acc = new StructurePageAccumulator(context);
  readText(acc, 1, 'Exercise-1\nPART I: SUBJECTIVE QUESTIONS\nSection (A): Phenol', [
    {
      section: 'Exercise-1',
      part: 'PART I: SUBJECTIVE QUESTIONS',
      topic: 'Section (A): Phenol',
      questionType: {
        value: 'subjective',
        printed: 'PART I: SUBJECTIVE QUESTIONS',
        level: 'part',
      },
    },
  ]);
  readText(acc, 2, 'Exercise-2\nPART I: SINGLE CORRECT', [
    {
      section: 'Exercise-2',
      part: 'PART I: SINGLE CORRECT',
      topic: null,
      questionType: {
        value: 'single_correct',
        printed: 'PART I: SINGLE CORRECT',
        level: 'part',
      },
    },
  ]);
  readText(acc, 3, 'PART II: INTEGER TYPE', [
    {
      section: null,
      part: 'PART II: INTEGER TYPE',
      topic: null,
      questionType: {
        value: 'integer',
        printed: 'PART II: INTEGER TYPE',
        level: 'part',
      },
    },
  ]);
  const result = validateStructure(acc.result(), 3, 'separate');
  const exercise = result.nodes[1];
  assert.ok(exercise);
  assert.equal(exercise.label, 'Exercise-2');
  assert.equal(exercise.questionType, '');
  assert.deepEqual(exercise.children, [
    leaf({ label: 'I', questionType: 'single_correct' }),
    leaf({ label: 'II', questionType: 'integer' }),
  ]);
  assert.equal(result.nodes[0]?.children[0]?.children[0]?.label, 'Phenol');
  assert.equal(result.nodes[0].children[0].children[0].questionType, 'subjective');
  assert.deepEqual(result.warnings, []);
});

void test('Section-only structure keeps its question type and manual slots without inventing children', () => {
  for (const layout of ['inline', 'combined', 'separate'] as const) {
    const acc = new StructurePageAccumulator({ ...context, answerLayout: layout });
    readText(acc, 1, 'Exercise-2: SINGLE CORRECT', [
      {
        section: 'Exercise-2: SINGLE CORRECT',
        part: null,
        topic: null,
        questionType: {
          value: 'single_correct',
          printed: 'Exercise-2: SINGLE CORRECT',
          level: 'section',
        },
      },
    ]);
    const result = validateStructure(acc.result(), 1, layout);
    const exercise = result.nodes[0];
    assert.ok(exercise);
    assert.deepEqual(exercise.children, []);
    assert.equal(exercise.level, 'section');
    assert.equal(exercise.questionType, 'single_correct');
    assert.deepEqual(
      exercise.pages,
      layout === 'inline'
        ? { question: [] }
        : layout === 'combined'
          ? { question: [], companion: [] }
          : { question: [], answer: [], solution: null },
    );
    assert.deepEqual(result.warnings, []);
  }
});

void test('numbered question and answer text never becomes a topic', () => {
  for (const topic of [
    'A-1. A substance with repeating units.',
    'A₁-1. Electron pair acceptor.',
    '1. Polyethylene',
    '(a) Nylon',
    'Answers',
    'Worked solutions',
  ]) {
    const acc = new StructurePageAccumulator(context);
    read(acc, 1, observation({ topic }));
    assert.deepEqual(acc.result().nodes[0]?.children, []);
  }
});

void test('same named topics with distinct printed Section letters remain distinct', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, observation({ topic: 'Section (A): Properties' }));
  read(acc, 2, observation({ topic: 'Section (B): Properties' }));
  assert.equal(acc.result().nodes[0]?.children.length, 2);
});

void test('invalid page JSON preserves observed headings and rejects page fields', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, observation({ topic: 'Section (A): Polymers' }));
  read(acc, 2, { items: [{ section: null, part: 'II', topic: 'Invented', pages: [2] }] });
  read(acc, 3, { items: [] });
  assert.equal(acc.result().nodes.length, 1);
  assert.equal(acc.result().warnings.length, 1);
  assert.deepEqual(acc.pageContext().previous, { section: null, part: null, topic: null });
  assert.equal(
    StructurePageObservationSchema.safeParse({
      items: [{ section: null, part: null, topic: null, questionIds: ['A1'] }],
    }).success,
    false,
  );
});

void test('blank topic names are valid but AI page attachments are rejected', () => {
  assert.doesNotThrow(() =>
    validateStructure({ nodes: [leaf({ level: 'topic', label: '' })] }, 2, 'separate'),
  );
  assert.throws(
    () => validateStructure({ nodes: [leaf({ pages: { question: [1] } })] }, 2, 'inline'),
    /page assignments are disabled/,
  );
  assert.throws(
    () => validateStructure({ nodes: [leaf({ label: '' })] }, 2, 'separate'),
    /Invalid Section/,
  );
  assert.throws(() => validateStructure({ nodes: [] }, 2, 'separate'), /No printed structure/);
});

void test('manual answer layout controls only the empty editor slots', () => {
  for (const layout of ['inline', 'combined', 'separate'] as const) {
    const acc = new StructurePageAccumulator({ ...context, answerLayout: layout });
    read(acc, 1, observation({ topic: 'Topic: Polymers' }));
    const result = validateStructure(acc.result(), 1, layout);
    assert.deepEqual(
      result.nodes[0]?.children[0]?.pages,
      layout === 'inline'
        ? { question: [] }
        : layout === 'combined'
          ? { question: [], companion: [] }
          : { question: [], answer: [], solution: null },
    );
  }
});

void test('model output contains copied headings and evidenced question type, and forbids invented topics', () => {
  const schema = structureJsonSchema();
  const item = jsonAt(schema, 'properties', 'crops', 'items', 'properties', 'items', 'items');
  assert.deepEqual(jsonAt(item, 'required'), ['section', 'part', 'topic', 'questionType']);
  assert.deepEqual(Object.keys(z.record(z.unknown()).parse(jsonAt(item, 'properties'))), [
    'section',
    'part',
    'topic',
    'questionType',
  ]);
  assert.equal(jsonAt(item, 'additionalProperties'), false);
  const prompt = structurePrompt(context, []);
  assert.match(prompt, /ordered OCR crops/);
  assert.match(prompt, /Organic Reaction Mechanisms-I/);
  assert.match(prompt, /Never output page numbers/);
  assert.match(STRUCTURE_SYSTEM_PROMPT, /never invent or infer a topic/i);
});
function encodeFixturePdf(objects: readonly (string | Buffer)[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let length = chunks[0]?.length ?? 0;
  const offsets = objects.map((object, index) => {
    const offset = length;
    const chunk = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`),
      typeof object === 'string' ? Buffer.from(object) : object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
    return offset;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}
function fixturePdf(lines: readonly (readonly string[])[] = [['PART 1'], ['PART 1']]): Buffer {
  // Two-page PDF built with correct byte offsets; no real educational data is sent in tests.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${lines.map((_, index) => `${String(4 + index * 2)} 0 R`).join(' ')}] /Count ${String(lines.length)} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, texts] of lines.entries()) {
    const stream = texts
      .map(
        (text, line) =>
          `BT /F1 12 Tf 30 ${String(760 - line * 24)} Td (${text.replace(/[\\()]/gu, '\\$&')}) Tj ET`,
      )
      .join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + index * 2)} 0 R >>`,
      `<< /Length ${String(Buffer.byteLength(stream))} >>\nstream\n${stream}\nendstream`,
    );
  }
  return encodeFixturePdf(objects);
}

void test('cost accounts for cache savings and includes reasoning once as output', () => {
  const pricing = structurePricing('gpt-5.4-mini-2026-03-17', 10000);
  assert.ok(pricing);
  // 8K fresh + 2K cached input, 1K output (including reasoning).
  assert.equal(structureCostUsd(pricing, 10000, 1000, 2000), 0.01065);
  assert.equal(structurePricing('unknown-model', 10000), null);
  assert.equal(structurePricing('gpt-5.4-pro', 10000), null);
  assert.equal(structureCostUsd(null, 10000, 1000), null);
  assert.equal(structureCostUsd(pricing, 0, 0), 0);
});

void test('long-context pricing applies to all tokens above the 272K threshold for GPT-5.4', () => {
  assert.equal(structurePricing('gpt-5.4', 272000)?.inputPerMillion, 2.5);
  assert.equal(structurePricing('gpt-5.4', 272001)?.inputPerMillion, 5);
  assert.equal(structurePricing('gpt-5.4', 272001)?.outputPerMillion, 22.5);
  assert.equal(structurePricing('gpt-5.4-mini', 272001)?.inputPerMillion, 0.75);
  const estimate = estimateStructure('gpt-5.4', { context, crops: textCrops, pageCount: 100 });
  assert.ok(estimate.costUsd);
  assert.equal(
    estimate.costUsd.max,
    structureCostUsd(
      structurePricing('gpt-5.4', Math.ceil(estimate.inputTokens.max / estimate.callCount)),
      estimate.inputTokens.max,
      estimate.outputTokens.max,
    ),
  );
});

void test('service returns charged usage even when generated structure fails validation', async () => {
  const receipt = {
    model: 'gpt-5.4-mini',
    promptTokens: 10000,
    completionTokens: 1000,
    totalTokens: 11000,
    callCount: 1 as const,
    cachedPromptTokens: 2000,
    reasoningTokens: 300,
    pricing: structurePricing('gpt-5.4-mini', 10000),
    costUsd: 0.01065,
  };
  const unused = new Proxy(
    {},
    {
      get: () => {
        throw new Error('Unexpected upload dependency');
      },
    },
  );
  let removed = false;
  let valid = false;
  const recorded: unknown[] = [];
  const service = new IngestionService(
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    {
      createSignedUpload: async () => ({ path: 'tmp', uploadUrl: 'https://example.com' }),
      download: async () => fixturePdf(),
      remove: async () => {
        removed = true;
      },
    },
    {
      estimate: (input) => estimateStructure('gpt-5.4-mini', input),
      extract: async (input) => {
        await input.onUsage(receipt);
        await input.onUsage(receipt);
        return { nodes: valid ? [leaf()] : [] };
      },
    },
    {
      assertWithinLimit: async () => {},
      recordUsage: async (usage: unknown) => {
        recorded.push(usage);
      },
    } as never,
    { resolveContext: async () => null },
    emptyOcr,
    70,
  );
  await assert.rejects(
    service.detectStructure({ crops: textCrops, pageCount: 2, context }),
    (error: unknown) => {
      assert.ok(AppError.is(error));
      assert.deepEqual(error.details, {
        usage: {
          ...receipt,
          promptTokens: 20000,
          completionTokens: 2000,
          totalTokens: 22000,
          callCount: 2,
          cachedPromptTokens: 4000,
          reasoningTokens: 600,
          costUsd: 0.0213,
        },
      });
      return true;
    },
  );
  assert.equal(removed, false);
  assert.equal(recorded.length, 2);
  valid = true;
  const result = await service.detectStructure({ crops: textCrops, pageCount: 2, context });
  assert.equal(result.usage?.callCount, 2);
  assert.equal(result.usage.costUsd, 0.0213);
});

void test('rule identity isolates providers and sources while folding case and whitespace', async () => {
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  const first = await service.save({ ...ruleInput, provider: 'Allen' });
  await service.save({ ...ruleInput, provider: 'PW', notes: 'PW examples' });
  await service.save({
    ...ruleInput,
    source: 'textbook',
    provider: 'Allen',
    notes: 'Textbook examples',
  });
  assert.equal(
    (await service.resolve({ source: 'module', provider: ' ALLEN ' }))?.notes,
    first.notes,
  );
  assert.equal((await service.resolve({ source: 'module', provider: 'PW' }))?.notes, 'PW examples');
  assert.equal(
    (await service.resolve({ source: 'textbook', provider: 'Allen' }))?.notes,
    'Textbook examples',
  );
  assert.equal(await service.resolve({ source: 'module', provider: 'Other' }), null);
  const changed = await service.save({
    ...ruleInput,
    provider: 'Allen',
    notes: 'Updated Allen notes',
  });
  assert.equal((await service.list()).length, 3);
  assert.equal(
    (await service.resolve({ source: 'module', provider: 'allen' }))?.notes,
    changed.notes,
  );
  const row = await service.resolve({ source: 'module', provider: 'Allen' });
  if (row) row.notes = 'Client mutation';
  assert.equal(
    (await service.resolve({ source: 'module', provider: 'Allen' }))?.notes,
    'Updated Allen notes',
  );
});

void test('source context selects module/textbook provider or PYQ exam', () => {
  assert.deepEqual(structureRuleScope(context), { source: 'module', provider: 'Resonance' });
  assert.deepEqual(structureRuleScope({ ...context, source: 'textbook', module: 'NCERT' }), {
    source: 'textbook',
    provider: 'NCERT',
  });
  assert.deepEqual(
    structureRuleScope({
      ...context,
      source: 'pyq',
      paper: { ...context.paper, pyqExamName: 'NEET' },
    }),
    { source: 'pyq', provider: 'NEET' },
  );
  assert.deepEqual(structureRuleScope({ ...context, source: 'pyq', exam: 'JEE Main' }), {
    source: 'pyq',
    provider: 'JEE Main',
  });
  assert.equal(structureRuleScope({ ...context, source: 'custom' }), null);
  assert.equal(structureRuleScope({ ...context, module: '' }), null);
  assert.equal(
    structureRuleScopeKey({ source: 'module', provider: 'New   Module' }),
    structureRuleScopeKey({ source: 'module', provider: ' new module ' }),
  );
});

void test('empty recognition sets and oversized notes fail before persistence', async () => {
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  const empty = { ...savedRule, examples: { section: '', part: '', topic: '' }, notes: '' };
  assert.equal(SaveStructureRuleSchema.safeParse(empty).success, false);
  await assert.rejects(service.save(empty), /validation/);
  assert.equal(
    SaveStructureRuleSchema.safeParse({ ...ruleInput, notes: 'x'.repeat(2001) }).success,
    false,
  );
  assert.equal(SaveStructureRuleSchema.safeParse({ ...ruleInput, provider: '' }).success, false);
  const saved = await service.save({
    ...ruleInput,
    examples: { section: 'Exercise-1', part: '', topic: '' },
  });
  assert.equal(StructureRuleSchema.safeParse(saved).success, true);
});

void test('saved examples increase the planning estimate without adding AI calls', () => {
  const base = estimateStructure('gpt-5.4-mini', { context, crops: textCrops, pageCount: 2 });
  const customized = estimateStructure('gpt-5.4-mini', {
    context,
    crops: textCrops,
    pageCount: 2,
    rule: savedRule,
  });
  assert.ok(customized.inputTokens.min > base.inputTokens.min);
  assert.equal(customized.callCount, base.callCount);
  const prompt = structurePrompt(context, [], undefined, savedRule);
  assert.match(prompt, /"output":"I"/);
  assert.match(prompt, /"output":"Polymers"/);
  assert.match(prompt, /Notes cannot override/);
});

void test('Mongo rules use an atomic scoped upsert and survive a new store instance', async () => {
  const rows = new Map<string, Record<string, unknown>>();
  const commands: unknown[] = [];
  const prisma = {
    $runCommandRaw: async (raw: unknown) => {
      commands.push(raw);
      const command = z.record(z.unknown()).parse(raw);
      if (command.update) {
        const change = jsonAt(command, 'updates', '0');
        const id = z.string().parse(jsonAt(change, 'q', '_id'));
        const fields = z.record(z.unknown()).parse(jsonAt(change, 'u', '$set'));
        rows.set(id, { _id: id, ...fields });
        return { ok: { $numberInt: '1' }, n: { $numberInt: '1' } };
      }
      const all = [...rows.values()];
      const id = jsonAt(command, 'filter', '_id');
      return {
        cursor: {
          firstBatch: id ? all.filter((value) => value._id === id) : all,
        },
      };
    },
  };
  const store = new MongoStructureRuleStore(prisma as never);
  await store.save(fourLevelRule);
  await store.save({ ...savedRule, provider: 'PW' });
  const next = new MongoStructureRuleStore(prisma as never);
  assert.equal(
    (await next.find({ source: 'module', provider: 'resonance' }))?.provider,
    'Resonance',
  );
  assert.equal((await next.list()).length, 2);
  assert.deepEqual(
    (await next.find({ source: 'module', provider: 'Resonance' }))?.hierarchy,
    fourLevelRule.hierarchy,
  );
  assert.equal(jsonAt(commands[0], 'updates', '0', 'upsert'), true);
  assert.equal(jsonAt(commands[0], 'update'), 'ingest_structure_rules');
  const rejected = new MongoStructureRuleStore({
    $runCommandRaw: async () => ({ ok: 1, writeErrors: [{ errmsg: 'failed' }] }),
  } as never);
  await assert.rejects(rejected.save(savedRule), /Could not save structure rules/);
});

void test('ingestion reads a matching rule once per run and returns the same snapshot', async () => {
  let reads = 0;
  let extractions = 0;
  let seen: StructureRule | null | undefined;
  const unused = new Proxy(
    {},
    {
      get: () => {
        throw Error('Unexpected upload dependency');
      },
    },
  );
  const service = new IngestionService(
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    {
      createSignedUpload: async () => ({ path: 'tmp', uploadUrl: 'https://example.com' }),
      download: async () => fixturePdf(),
      remove: async () => {},
    },
    {
      estimate: (input) => {
        seen = input.rule;
        return estimateStructure('gpt-5.4-mini', input);
      },
      extract: async (input) => {
        extractions += 1;
        seen = input.rule;
        return { nodes: [leaf()] };
      },
    },
    { assertWithinLimit: async () => {}, recordUsage: async () => {} } as never,
    {
      resolveContext: async (input) => {
        reads += 1;
        assert.equal(input.module, 'Resonance');
        return savedRule;
      },
    },
    emptyOcr,
    70,
  );
  const result = await service.detectStructure({ crops: textCrops, pageCount: 2, context });
  assert.equal(reads, 1);
  assert.deepEqual(seen, savedRule);
  assert.deepEqual(result.rule, savedRule);
  assert.deepEqual(result.nodes[0]?.pages, { question: [], answer: [], solution: null });
  const estimate = await service.estimateStructure({ pageCount: 2, context, crops: textCrops });
  assert.equal(reads, 2);
  assert.deepEqual(seen, savedRule);
  assert.equal(estimate.callCount, 1);
  await assert.rejects(
    service.detectStructure({
      pageCount: 1,
      context,
      crops: [{ id: 'removed-level', pageNumber: 1, role: 'removed', text: 'A heading' }],
    }),
    /removed or unknown hierarchy level/,
  );
  assert.equal(extractions, 1);
});

void test('full generation enables code-owned question ranges while the individual-crop AI button leaves pages empty', async () => {
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () =>
    batchResponse(textCrops, [
      [
        {
          section: { printed: 'Exercise-1', label: 'Exercise-1' },
          part: { printed: 'PART 1', label: '1' },
          topic: { printed: 'Section (A): Polymers', label: 'Polymers' },
        },
      ],
    ]),
  );
  const unused = new Proxy(
    {},
    {
      get: () => {
        throw new Error('Unexpected upload dependency');
      },
    },
  );
  const service = new IngestionService(
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    unused as never,
    adapter,
    { assertWithinLimit: async () => {}, recordUsage: async () => {} } as never,
    { resolveContext: async () => null },
    emptyOcr,
    70,
  );
  const full = await service.detectStructure({ crops: textCrops, pageCount: 3, context });
  assert.deepEqual(full.nodes[0]?.children[0]?.children[0]?.pages, {
    question: [1, 2, 3],
    answer: [],
    solution: null,
  });
  const individual = await service.detectStructure({
    crops: textCrops,
    pageCount: 3,
    context,
    cropOnly: true,
  });
  assert.deepEqual(individual.nodes[0]?.children[0]?.children[0]?.pages.question, []);
});

void test('expected output pairs persist independently and legacy profiles remain readable', async () => {
  assert.equal(StructureRuleSchema.parse(savedRule).expectedOutputs, undefined);
  const service = new StructureRulesService(new InMemoryStructureRuleStore());
  const saved = await service.save({
    ...ruleInput,
    examples: customRule.examples,
    expectedOutputs: customRule.expectedOutputs,
  });
  assert.deepEqual(
    (await service.resolveContext(context))?.expectedOutputs,
    customRule.expectedOutputs,
  );
  assert.deepEqual(StructureRuleSchema.parse(saved).expectedOutputs, customRule.expectedOutputs);
});

void test('expected outputs require printed examples and cannot invent a Topic name', () => {
  const input = {
    ...ruleInput,
    examples: customRule.examples,
    expectedOutputs: customRule.expectedOutputs,
  };
  assert.equal(SaveStructureRuleSchema.safeParse(input).success, true);
  assert.equal(
    SaveStructureRuleSchema.safeParse({
      ...input,
      expectedOutputs: { section: null, part: '', topic: 'Chemical Bonding' },
    }).success,
    false,
  );
  assert.equal(
    SaveStructureRuleSchema.safeParse({
      ...input,
      examples: { ...input.examples, part: '' },
    }).success,
    false,
  );
  assert.equal(
    SaveStructureRuleSchema.safeParse({
      ...input,
      expectedOutputs: { ...input.expectedOutputs, topic: 'Polymers' },
    }).success,
    false,
  );
  assert.equal(
    SaveStructureRuleSchema.safeParse({
      ...input,
      expectedOutputs: { ...input.expectedOutputs, topic: '' },
    }).success,
    true,
  );
});

void test('custom prompt and schema carry printed/output pairs without changing the three levels', () => {
  const prompt = structurePrompt(context, [], undefined, customRule);
  assert.match(prompt, /"printed":"Level 2: Objective Questions","output":"2","customOutput":true/);
  assert.match(prompt, /never copy a sample's number or topic name/);
  const schema = structureJsonSchema(customRule);
  const item = jsonAt(schema, 'properties', 'crops', 'items', 'properties', 'items', 'items');
  assert.deepEqual(jsonAt(item, 'required'), ['section', 'part', 'topic', 'questionType']);
  assert.deepEqual(jsonAt(item, 'properties', 'part', 'anyOf', '0', 'required'), [
    'printed',
    'label',
  ]);
  assert.equal(jsonAt(item, 'properties', 'part', 'anyOf', '0', 'additionalProperties'), false);
  const estimate = estimateStructure('gpt-5.4-mini', {
    context,
    crops: textCrops,
    pageCount: 2,
    rule: customRule,
  });
  assert.equal(estimate.callCount, 1);
});

void test('custom output patterns use actual page names and retain raw heading context', () => {
  const acc = new StructurePageAccumulator(context, customRule);
  read(acc, 1, {
    items: [
      {
        section: { printed: 'Practice Sheet-2', label: 'Practice Sheet-2' },
        part: { printed: 'Level 2: Objective Questions', label: '2' },
        topic: { printed: 'Block B: Chemical Bonding', label: 'Chemical Bonding' },
      },
    ],
  });
  read(acc, 2, {
    items: [
      {
        section: null,
        part: { printed: 'Level 3: Objective Questions', label: '3' },
        topic: { printed: 'Block C: Biomolecules', label: 'Biomolecules' },
      },
    ],
  });
  assert.equal(acc.pageContext().previous.part, 'Level 3: Objective Questions');
  assert.equal(acc.pageContext().previous.topic, 'Block C: Biomolecules');
  const result = validateStructure(acc.result(), 2, 'separate', customRule);
  const parts = result.nodes[0]?.children;
  assert.deepEqual(
    parts?.map((node) => node.label),
    ['2', '3'],
  );
  assert.deepEqual(
    parts.map((node) => node.children[0]?.label),
    ['Chemical Bonding', 'Biomolecules'],
  );
  assert.deepEqual(parts[1]?.children[0]?.pages, { question: [], answer: [], solution: null });
  const overridden = validateStructure(
    { nodes: [leaf({ label: 'PART 3' })] },
    1,
    'separate',
    customRule,
  );
  assert.equal(overridden.nodes[0]?.label, 'PART 3');
});

void test('custom outputs cannot fill missing topics, copy sample names or promote answers', () => {
  for (const topic of [
    { printed: 'Section (A)', label: 'Chemical Bonding' },
    { printed: 'Block C: Biomolecules', label: 'Chemical Bonding' },
    { printed: 'A-1. Chemical Bonding is an attraction between atoms.', label: 'Chemical Bonding' },
  ]) {
    const acc = new StructurePageAccumulator(context, customRule);
    read(acc, 1, { items: [{ section: null, part: { printed: 'Level 2', label: '2' }, topic }] });
    const part = acc.result().nodes[0];
    assert.ok(part);
    if (topic.printed.startsWith('A-1.')) assert.deepEqual(part.children, []);
    else assert.equal(part.children[0]?.label, '');
  }
  const incomplete = new StructurePageAccumulator(context, customRule);
  read(incomplete, 1, observation({ part: 'Level 2' }));
  assert.deepEqual(incomplete.result().nodes, []);
  assert.match(incomplete.result().warnings.join(' '), /omitted a configured output label/);
});

void test('custom labels preserve distinct printed Topics and can explicitly remain blank', () => {
  const acc = new StructurePageAccumulator(context, customRule);
  read(acc, 1, {
    items: [
      {
        section: null,
        part: { printed: 'Level 2', label: '2' },
        topic: { printed: 'Block B: Chemical Bonding', label: 'Chemical Bonding' },
      },
      {
        section: null,
        part: null,
        topic: { printed: 'Block C: Chemical Bonding', label: 'Chemical Bonding' },
      },
    ],
  });
  assert.equal(acc.result().nodes[0]?.children.length, 2);
  const blank = new StructurePageAccumulator(context, {
    ...customRule,
    expectedOutputs: { section: null, part: '2', topic: '' },
  });
  read(blank, 1, {
    items: [
      {
        section: null,
        part: { printed: 'Level 2', label: '2' },
        topic: { printed: 'Block B: Chemical Bonding', label: '' },
      },
    ],
  });
  assert.equal(blank.result().nodes[0]?.children[0]?.label, '');
});

void test('candidates use printed markers/provider formats and exclude exam years and question text', () => {
  const lines = [
    'Exercise-1',
    'PART I: SUBJECTIVE QUESTIONS',
    'Section (G) : Magnetic force on a charge (oblique incidence)',
    'AIPMT 2006',
    'Section (A): NEET-UG 2013',
    '1. A charge moves in a magnetic field.',
    'Block C: Biomolecules',
  ];
  const candidates = structureHeadingCandidates(lines, customRule);
  assert.deepEqual(candidates.section, ['Exercise-1']);
  assert.deepEqual(candidates.part, ['PART I: SUBJECTIVE QUESTIONS']);
  assert.deepEqual(candidates.topic, [lines[2], lines[6]]);
});

void test('noisy markers retain raw evidence; instruction notes and unmarked titles cannot become parents', () => {
  const candidates = structureHeadingCandidates(
    [
      'Il Exercise-3',
      'Bl Exercise-1',
      'PART - III : SINGLE CORRECT',
      '* Marked Questions may have more than one correct option.',
      '2 Marked questions are recommended for Revision.',
      'JEE(MAIN) OFFLINE PROBLEM',
      'Aromatic Compounds',
    ],
    null,
    true,
  );
  assert.deepEqual(candidates.section, ['Il Exercise-3', 'Bl Exercise-1']);
  assert.deepEqual(candidates.part, ['PART - III : SINGLE CORRECT']);
  assert.deepEqual(candidates.topic, ['Aromatic Compounds']);
});

void test('clean labels remove OCR decoration while preserving raw context and repeated parents', () => {
  const acc = new StructurePageAccumulator(context);
  const topic = 'Section (G) : Magnetic force on a charge (oblique incidence)';
  const part = 'PART - III : SUBJECTIVE QUESTIONS';
  acc.accept(
    1,
    {
      items: [
        {
          section: { printed: 'Il Exercise-3', label: 'Exercise-3' },
          part: { printed: part, label: 'III' },
          topic: { printed: topic, label: 'Magnetic force on a charge (oblique incidence)' },
        },
      ],
    },
    structureHeadingCandidates(['Il Exercise-3', part, topic]),
  );
  assert.equal(acc.pageContext().previous.section, 'Il Exercise-3');
  acc.accept(
    2,
    {
      items: [
        {
          section: { printed: 'Exercise-3', label: 'Exercise-3' },
          part: null,
          topic: null,
        },
      ],
    },
    structureHeadingCandidates(['Exercise-3']),
  );
  const result = acc.result();
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0]?.label, 'Exercise-3');
  assert.equal(result.nodes[0].children[0]?.label, 'III');
  assert.equal(
    result.nodes[0].children[0].children[0]?.label,
    'Magnetic force on a charge (oblique incidence)',
  );
  assert.deepEqual(result.warnings, []);
});

void test('label cleanup cannot change heading identifiers or truncate or invent topic wording', () => {
  for (const wrongTopic of ['Magnetic force on a charge', 'Polymers']) {
    const acc = new StructurePageAccumulator(context);
    const topic = 'Section (G) : Magnetic force on a charge (oblique incidence)';
    acc.accept(
      1,
      {
        items: [
          {
            section: { printed: 'Il Exercise-3', label: 'Exercise-99' },
            part: { printed: 'PART III: SUBJECTIVE QUESTIONS', label: 'II' },
            topic: { printed: topic, label: wrongTopic },
          },
        ],
      },
      structureHeadingCandidates(['Il Exercise-3', 'PART III: SUBJECTIVE QUESTIONS', topic]),
    );
    assert.equal(acc.result().nodes[0]?.label, 'Exercise-3');
    assert.equal(acc.result().nodes[0]?.children[0]?.label, 'III');
    assert.equal(
      acc.result().nodes[0]?.children[0]?.children[0]?.label,
      'Magnetic force on a charge (oblique incidence)',
    );
    assert.equal(acc.result().warnings.length, 3);
  }
});

void test('dynamic schema permits only verified current-page headings, never template values', () => {
  const printed = 'Section (G) : Magnetic force on a charge (oblique incidence)';
  const candidates = structureHeadingCandidates(['Exercise-3', printed]);
  const schema = structureJsonSchema(null, candidates);
  const headings = jsonAt(
    schema,
    'properties',
    'crops',
    'items',
    'properties',
    'items',
    'items',
    'properties',
  );
  assert.deepEqual(jsonAt(headings, 'section', 'anyOf', '0', 'properties', 'printed', 'enum'), [
    'Exercise-3',
  ]);
  assert.deepEqual(jsonAt(headings, 'part'), { type: 'null' });
  assert.deepEqual(jsonAt(headings, 'topic', 'anyOf', '0', 'properties', 'printed', 'enum'), [
    printed,
  ]);
  const custom = structureJsonSchema(customRule, candidates);
  assert.deepEqual(
    jsonAt(
      custom,
      'properties',
      'crops',
      'items',
      'properties',
      'items',
      'items',
      'properties',
      'topic',
      'anyOf',
      '0',
      'properties',
      'printed',
      'enum',
    ),
    [printed],
  );
});

void test('unprinted topics cannot come from metadata, examples or another page', () => {
  const acc = new StructurePageAccumulator(context);
  const printed = 'Section (G) : Magnetic force on a charge (oblique incidence)';
  acc.accept(
    1,
    observation({ section: 'Exercise-1', part: 'PART I', topic: printed }),
    structureHeadingCandidates(['Exercise-1', 'PART I', printed]),
  );
  for (const [index, topic] of ['Polymers', context.chapter, 'AIPMT 2006', printed].entries()) {
    acc.accept(
      index + 2,
      observation({ part: null, topic }),
      structureHeadingCandidates(['1. Identify the force acting on the charge.']),
    );
  }
  const result = validateStructure(acc.result(), 5, 'separate');
  assert.deepEqual(
    result.nodes[0]?.children[0]?.children.map((node) => node.label),
    ['Magnetic force on a charge (oblique incidence)'],
  );
  assert.equal(result.warnings.length, 4);
  assert.equal(acc.pageContext().previous.topic, null);
});

void test('unsupported parents do not attach valid topics to the previous hierarchy', () => {
  const acc = new StructurePageAccumulator(context);
  acc.accept(
    1,
    observation({ section: 'Exercise-1', part: 'PART I' }),
    structureHeadingCandidates(['Exercise-1', 'PART I']),
  );
  acc.accept(
    2,
    observation({ section: 'Exercise-99', part: 'PART II', topic: 'Section (B): Waves' }),
    structureHeadingCandidates(['PART II', 'Section (B): Waves']),
  );
  assert.deepEqual(
    acc.result().nodes[0]?.children.map((node) => node.label),
    ['I'],
  );
  assert.deepEqual(acc.pageContext().previous, { section: null, part: null, topic: null });
  assert.match(acc.result().warnings[0] ?? '', /rejected section/);
});

void test('configured output labels cannot copy another heading number or topic name', () => {
  const acc = new StructurePageAccumulator(context, customRule);
  acc.accept(
    1,
    {
      items: [
        {
          section: { printed: 'Practice Sheet-3', label: 'Practice Sheet-3' },
          part: { printed: 'Level 3: Objective Questions', label: '99' },
          topic: { printed: 'Block C: Biomolecules', label: 'Chemical Bonding' },
        },
      ],
    },
    structureHeadingCandidates(
      ['Practice Sheet-3', 'Level 3: Objective Questions', 'Block C: Biomolecules'],
      customRule,
    ),
  );
  assert.equal(acc.result().warnings.length, 2);
  assert.deepEqual(
    acc.result().nodes[0]?.children.map((node) => node.label),
    [''],
  );
});

void test('grounding permits Roman Part identifiers and PDF spacing changes in configured examples', () => {
  const acc = new StructurePageAccumulator(context, customRule);
  const first = 'LEVEL 2: Objective  Questions';
  const second = 'Level III: Objective Questions';
  acc.accept(
    1,
    { items: [{ section: null, part: { printed: first, label: '99' }, topic: null }] },
    structureHeadingCandidates([first], customRule),
  );
  acc.accept(
    2,
    { items: [{ section: null, part: { printed: second, label: '3' }, topic: null }] },
    structureHeadingCandidates([second], customRule),
  );
  assert.deepEqual(
    acc.result().nodes.map((node) => node.label),
    ['2', '3'],
  );
  assert.deepEqual(acc.result().warnings, []);
});

void test('sequential text-only calls carry three, two and one heading changes; pages stay manual', async () => {
  const crops = [
    {
      id: 'a',
      pageNumber: 1,
      text: 'Exercise-1\nPART I: SUBJECTIVE QUESTIONS\nSection (A): Polymers',
    },
    { id: 'b', pageNumber: 2, text: 'PART II: OBJECTIVE QUESTIONS\nSection (B): Biomolecules' },
    { id: 'c', pageNumber: 3, text: 'Section (C): Chemical Bonding' },
    { id: 'd', pageNumber: 4, text: 'Exercise-2' },
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  const receipts: unknown[] = [];
  fakeModel(adapter, (request) => {
    calls += 1;
    assert.ok(request.messages.every((message) => typeof message.content === 'string'));
    const prompt = request.messages[1]?.content ?? '';
    assert.match(prompt, /Saved source\/provider heading guide/);
    assert.ok(!JSON.stringify(request).includes('image_url'));
    assert.match(prompt, /cropId/);
    if (calls === 2)
      assert.match(prompt, /"section":"Exercise-1","part":"PART I: SUBJECTIVE QUESTIONS"/);
    if (calls === 3) assert.match(prompt, /"part":"PART II: OBJECTIVE QUESTIONS"/);
    const items: StructurePageObservation['items'][] = [
      [
        {
          section: 'Exercise-1',
          part: 'PART I: SUBJECTIVE QUESTIONS',
          topic: 'Section (A): Polymers',
        },
      ],
      [{ section: null, part: 'PART II: OBJECTIVE QUESTIONS', topic: 'Section (B): Biomolecules' }],
      [{ section: null, part: null, topic: 'Section (C): Chemical Bonding' }],
      [{ section: 'Exercise-2', part: null, topic: null }],
    ];
    return batchResponse(crops.slice(calls - 1, calls), items.slice(calls - 1, calls));
  });
  const result = validateStructure(
    await adapter.extract({
      crops,
      pageCount: 4,
      context,
      onUsage: async (usage) => {
        receipts.push(usage);
      },
    }),
    4,
    'separate',
  );
  assert.equal(calls, 4);
  assert.equal(receipts.length, 4);
  assert.deepEqual(
    result.nodes.map((node) => node.label),
    ['Exercise-1', 'Exercise-2'],
  );
  assert.deepEqual(
    result.nodes[0]?.children.map((node) => node.label),
    ['I', 'II'],
  );
  assert.deepEqual(
    result.nodes[0].children[1]?.children.map((node) => node.label),
    ['Biomolecules', 'Chemical Bonding'],
  );
  assert.deepEqual(result.nodes[1]?.children, []);
  assert.deepEqual(result.nodes[0].children[1].children[0]?.pages, {
    question: [],
    answer: [],
    solution: null,
  });
});

void test('explicit unnamed Topic creates a blank child; absent Topic and repeated parents continue', () => {
  const acc = new StructurePageAccumulator(context);
  read(acc, 1, {
    items: [{ section: 'Exercise-1', part: 'PART I', topic: 'Section (A): Polymers' }],
  });
  read(acc, 2, { items: [{ section: 'Exercise-1', part: 'PART I', topic: null }] });
  assert.equal(acc.pageContext().previous.topic, 'Section (A): Polymers');
  read(acc, 3, { items: [{ section: null, part: null, topic: 'Section (B)' }] });
  assert.equal(acc.pageContext().previous.topic, 'Section (B)');
  assert.deepEqual(
    acc.result().nodes[0]?.children[0]?.children.map((node) => node.label),
    ['Polymers', ''],
  );
});

void test('each crop is independently grounded even if the AI swaps crop text or response order', async () => {
  const crops = [
    { id: 'a', pageNumber: 1, text: 'PART I\nSection (A): Polymers' },
    { id: 'b', pageNumber: 2, text: 'Section (B): Biomolecules' },
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () => ({
    crops: [
      { cropId: 'b', items: [{ section: null, part: null, topic: 'Section (B): Biomolecules' }] },
      {
        cropId: 'a',
        items: [{ section: null, part: 'PART I', topic: 'Section (B): Biomolecules' }],
      },
    ],
  }));
  const result = validateStructure(
    await adapter.extract({ crops, pageCount: 2, context, onUsage: async () => {} }),
    2,
    'separate',
  );
  assert.ok(result.warnings.some((warning) => warning.includes('rejected topic')));
  assert.equal(result.nodes[0]?.label, 'I');
  assert.equal(result.nodes[0].children[0]?.label, 'Biomolecules');
});

void test('a budget stop after a text batch preserves earlier headings and prevents further calls', async () => {
  const crops = Array.from({ length: 13 }, (_, index) => ({
    id: String(index),
    pageNumber: index + 1,
    text: `PART ${String(index + 1)}`,
  }));
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  fakeModel(adapter, () => {
    calls += 1;
    return batchResponse(
      crops.slice(0, 1),
      crops.slice(0, 1).map((crop) => [{ section: null, part: crop.text, topic: null }]),
    );
  });
  let checks = 0;
  const result = validateStructure(
    await adapter.extract({
      crops,
      pageCount: 13,
      context,
      beforeBatch: async () => {
        if (++checks === 2) throw new Error('Budget exceeded');
      },
      onUsage: async () => {},
    }),
    13,
    'separate',
  );
  assert.equal(calls, 1);
  assert.equal(result.nodes.length, 1);
  assert.ok(result.warnings.some((warning) => warning.includes('Budget exceeded')));
});

void test('missing/duplicate crop results do not apply children under an uncertain parent', async () => {
  const crops = [
    { id: 'a', pageNumber: 1, text: 'Exercise-1\nPART I' },
    { id: 'b', pageNumber: 2, text: 'Exercise-2' },
    { id: 'c', pageNumber: 3, text: 'Section (A): Polymers' },
  ];
  const adapter = adapterFor('gpt-5.4-mini');
  fakeModel(adapter, () => ({
    crops: [
      { cropId: 'a', items: [{ section: 'Exercise-1', part: 'PART I', topic: null }] },
      { cropId: 'c', items: [{ section: null, part: null, topic: 'Section (A): Polymers' }] },
    ],
  }));
  const result = validateStructure(
    await adapter.extract({ crops, pageCount: 3, context, onUsage: async () => {} }),
    3,
    'separate',
  );
  assert.equal(result.nodes[0]?.label, 'Exercise-1');
  assert.equal(result.nodes[1]?.label, 'Polymers');
  assert.ok(result.warnings.some((warning) => warning.includes('missing or duplicated')));
});

void test('truncated JSON is billed once without retrying; blank text makes no request', async () => {
  const adapter = adapterFor('gpt-5.4-mini');
  let calls = 0;
  let usage = 0;
  fakeModel(
    adapter,
    () => {
      calls += 1;
      return { crops: [] };
    },
    'length',
  );
  const result = (await adapter.extract({
    crops: textCrops,
    pageCount: 1,
    context,
    onUsage: async () => {
      usage += 1;
    },
  })) as { nodes: unknown[]; warnings: string[] };
  assert.equal(usage, 1);
  assert.equal(calls, 1);
  assert.equal(result.nodes.length, 0);
  assert.match(result.warnings[0] ?? '', /incomplete or invalid/);
  await adapter.extract({
    crops: [{ id: 'blank', pageNumber: 1, text: '  ' }],
    pageCount: 1,
    context,
    onUsage: async () => {
      usage += 1;
    },
  });
  assert.equal(calls, 1);
});

void test('cost and batching use actual reviewed text rather than the full PDF page count', () => {
  const adapter = adapterFor('gpt-5.4-mini');
  const small = adapter.estimate({ context, pageCount: 2, crops: textCrops });
  const same = adapter.estimate({ context, pageCount: 100, crops: textCrops });
  assert.equal(small.callCount, 1);
  assert.equal(small.outputTokens.max, 10000);
  assert.equal(same.inputTokens.max, small.inputTokens.max);
  const many = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    pageNumber: 1,
    text: 'PART I',
  }));
  assert.equal(structureTextBatches(many).length, 25);
  assert.equal(adapter.estimate({ context, pageCount: 1, crops: many }).callCount, 25);
  assert.equal(adapter.estimate({ context, pageCount: 1, crops: many }).outputTokens.max, 250000);
  assert.equal(
    structureTextBatches(many.slice(0, 2).map((crop) => ({ ...crop, text: 'A'.repeat(12000) })))
      .length,
    2,
  );
  assert.equal(
    adapter.estimate({ context, pageCount: 1, crops: [{ id: 'empty', pageNumber: 1, text: '' }] })
      .costUsd?.max,
    0,
  );
});

void test('text input rejects duplicate IDs, impossible page references and oversized OCR', () => {
  assert.equal(
    StructureEstimateRequestSchema.safeParse({
      context,
      pageCount: 1,
      crops: [...textCrops, ...textCrops],
    }).success,
    false,
  );
  assert.equal(
    StructureEstimateRequestSchema.safeParse({
      context,
      pageCount: 1,
      crops: [{ id: 'a', pageNumber: 2, text: 'x' }],
    }).success,
    false,
  );
  assert.equal(
    StructureEstimateRequestSchema.safeParse({
      context,
      pageCount: 1,
      crops: [{ id: 'a', pageNumber: 1, text: 'x'.repeat(12001) }],
    }).success,
    false,
  );
});

function ocrService(ocr: PageOcr, png: Buffer, removed: () => void): IngestionService {
  return new IngestionService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      createSignedUpload: async () => ({ path: 'tmp', uploadUrl: 'https://example.com' }),
      download: async () => png,
      remove: async () => {
        removed();
      },
    },
    {
      estimate: (input) => estimateStructure('gpt-5.4-mini', input),
      extract: async () => {
        throw new Error('OCR must not call AI');
      },
    },
    {} as never,
    { resolveContext: async () => null },
    ocr,
    70,
  );
}

void test('OCR merge recovers missing lines, deduplicates overlap, preserves conflicts and reading order', () => {
  const automatic = [ocrLine('PART I', 50, 90), ocrLine('Section (A): Polymers', 100, 92)];
  const sparse = [
    ocrLine('Il Exercise-3', 0, 71),
    ocrLine('PART I', 50, 95),
    ocrLine('Section (A): Polymer', 100, 94),
    ocrLine('PART I', 150, 90),
  ];
  const merged = mergeOcrLines(automatic, sparse);
  assert.deepEqual(
    merged.map((line) => line.text),
    ['Il Exercise-3', 'PART I', 'Section (A): Polymers', 'PART I'],
  );
  assert.match(merged[0]?.warnings?.[0] ?? '', /recovered/);
  assert.equal(merged[1]?.confidence, 95);
  assert.deepEqual(merged[1].warnings, []);
  assert.match(merged[2]?.warnings?.[0] ?? '', /Polymers.*Polymer/);
  assert.equal(automatic[0]?.confidence, 90);
  assert.equal(automatic[0].warnings, undefined);
});

void test('OCR retains low-confidence lines in source order for review and always cleans temporary images', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  let closed = 0;
  let removed = 0;
  let fail = false;
  const service = ocrService(
    {
      open: async () => ({
        recognize: async () => {
          if (fail) throw new Error('OCR failed');
          return [
            ocrLine('Section (A): Polymers', 50, 30),
            { ...ocrLine('Exercise-1', 0), warnings: ['Additional OCR reading needs review.'] },
            ocrLine('PART I', 25),
          ];
        },
        close: async () => {
          closed += 1;
        },
      }),
    },
    png,
    () => {
      removed += 1;
    },
  );
  const result = await service.readStructureCrop({ storagePath: 'tmp', cropId: 'a' });
  assert.equal(result.text, 'Exercise-1\nPART I\nSection (A): Polymers');
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.includes('Additional OCR reading needs review.'));
  assert.equal(closed, 1);
  assert.equal(removed, 1);
  fail = true;
  await assert.rejects(service.readStructureCrop({ storagePath: 'tmp', cropId: 'a' }), /Tesseract/);
  assert.equal(closed, 2);
  assert.equal(removed, 2);
});

void test(
  'real Tesseract reads a heading crop without the question text below it',
  { timeout: 60000 },
  async () => {
    const document = await pdf(
      fixturePdf([
        [
          'Exercise-1',
          'PART 1: SUBJECTIVE QUESTIONS',
          'Section (G): Magnetic force on a charge (oblique incidence)',
          '1. This question must be outside the crop.',
        ],
      ]),
      { scale: 3 },
    );
    const image = await document.getPage(1);
    const png = await sharp(image)
      .extract({ left: 0, top: 0, width: 1800, height: 295 })
      .png()
      .toBuffer();
    const result: StructureCropOcrResult = await ocrService(
      new TesseractPageOcr(45000),
      png,
      () => {},
    ).readStructureCrop({ storagePath: 'tmp', cropId: 'real' });
    assert.match(result.text, /Exercise-1/);
    assert.match(result.text, /PART 1/);
    assert.match(result.text, /Magnetic force on a charge/);
    assert.ok(!result.text.includes('question must'));
  },
);
