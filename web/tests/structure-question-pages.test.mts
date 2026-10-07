import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { materializeStructureQuestions } from '../src/features/ingestion/lib/materialize-structure-questions.js';
import {
  parseConfig,
  serializeConfig,
  type ConfigNode,
} from '../src/features/ingestion/lib/structure-config.js';
import { emptyMetadata } from '../src/features/ingestion/types/chapter-group.js';

async function questionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let page = 1; page <= 8; page += 1) doc.addPage([600 + page, 800 + page]);
  return doc.save();
}

void test('applying generated ranges attaches the correct PDF pages only to final children and exports them again', async () => {
  const configs: ConfigNode[] = [
    {
      level: 'section',
      label: 'Exercise-1',
      children: [
        {
          level: 'part',
          label: '1',
          children: [
            {
              level: 'topic',
              label: 'Phenol',
              questionType: 'subjective',
              pages: { question: [1, 2, 3], answer: [99], solution: [99] },
              children: [],
            },
            {
              level: 'topic',
              label: 'Amines',
              questionType: 'subjective',
              pages: { question: [4, 5] },
              children: [],
            },
          ],
        },
        {
          level: 'part',
          label: '2',
          questionType: 'integer',
          pages: { question: [6, 7, 8] },
          children: [],
        },
      ],
    },
  ];
  const source = await questionPdf();
  const nodes = await materializeStructureQuestions(source, configs);
  assert.equal(nodes[0]?.bindings, undefined);
  assert.equal(nodes[0]?.children[0]?.bindings, undefined);
  const leaves = [
    nodes[0]?.children[0]?.children[0],
    nodes[0]?.children[0]?.children[1],
    nodes[0]?.children[1],
  ];
  const ranges = [
    [1, 2, 3],
    [4, 5],
    [6, 7, 8],
  ];
  source.fill(0);
  for (const [index, node] of leaves.entries()) {
    assert.ok(node);
    const artifact = node.bindings?.question;
    assert.ok(artifact);
    const expected = ranges[index];
    assert.ok(expected);
    assert.deepEqual(artifact.pageNumbers, expected);
    assert.equal(artifact.pageCount, expected.length);
    assert.equal(node.bindings?.answer, undefined);
    assert.equal(node.bindings?.solution, undefined);
    const pdf = await PDFDocument.load(artifact.bytes);
    assert.equal(pdf.getPageCount(), expected.length);
    assert.deepEqual(
      pdf.getPages().map((page) => page.getWidth()),
      expected.map((page) => 600 + page),
    );
  }
  const exported = parseConfig(
    JSON.stringify(
      serializeConfig({ metadata: { ...emptyMetadata(), answerLayout: 'separate' }, nodes }),
    ),
  );
  assert.ok(exported);
  assert.deepEqual(
    exported.nodes[0]?.children[0]?.children.map((node) => node.pages?.question),
    [
      [1, 2, 3],
      [4, 5],
    ],
  );
  assert.deepEqual(exported.nodes[0].children[1]?.pages?.question, [6, 7, 8]);
  assert.equal(exported.nodes[0].children[0].children[0]?.pages?.solution, null);
});

void test('invalid generated ranges reject the whole apply without changing the input structure', async () => {
  const configs: ConfigNode[] = [
    { label: 'First', level: 'topic', pages: { question: [1, 2] }, children: [] },
    { label: 'Invalid', level: 'topic', pages: { question: [9] }, children: [] },
  ];
  const original = JSON.stringify(configs);
  await assert.rejects(
    materializeStructureQuestions(await questionPdf(), configs),
    /outside the loaded PDF/,
  );
  assert.equal(JSON.stringify(configs), original);
});
