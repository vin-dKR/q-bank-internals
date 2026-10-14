import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';
import { readNativeChoiceKeys, readNativePageSources } from '../src/infrastructure/pdf/page-layout.js';

type PrintItem = { text: string; x: number; y: number };

function fixture(items: PrintItem[], clipTop = false): Buffer {
  const escape = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const text = items.map((item) => `BT /F1 10 Tf ${String(item.x)} ${String(item.y)} Td (${escape(item.text)}) Tj ET`).join('\n');
  const content = clipTop ? '/Fm Do' : text;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> ${clipTop ? '/XObject << /Fm 6 0 R >>' : ''} >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    ...(clipTop ? [`<< /Type /XObject /Subtype /Form /BBox [0 100 300 200] /Resources << /Font << /F1 4 0 R >> >> /Length ${String(text.length)} >>\nstream\n${text}\nendstream`] : []),
  ];
  let result = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  result += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(start)}\n%%EOF`;
  return Buffer.from(result);
}

async function painted(bytes: Buffer): Promise<Buffer> {
  const pages = await pdf(bytes, { scale: 3 });
  return pages.getPage(1);
}

const firstRow: PrintItem[] = [
  { text: 'AB-17.', x: 10, y: 170 }, { text: '(C)', x: 60, y: 170 },
  { text: 'CD.22.', x: 150, y: 170 }, { text: '(A)', x: 200, y: 170 },
];

void test('literal compact keys keep their complete printed prefixes across separate glyph runs and merged items', async () => {
  const bytes = fixture([...firstRow, { text: 'EF-9. (D)', x: 10, y: 140 }]);
  const png = await painted(bytes);
  const expected = { 'AB-17': 'C', 'CD-22': 'A', 'EF-9': 'D' };
  assert.deepEqual(await readNativeChoiceKeys(bytes, 1, png), expected);
  const sources = await readNativePageSources(bytes, 1, png);
  assert.deepEqual(sources.choiceKeys, expected);
  assert.ok(sources.layout);
  assert.deepEqual(new Set(sources.layout.questions.map((question) => question.printedLabel)), new Set(Object.keys(expected)));
});

void test('clipped native keys remain excluded even when unrelated raster ink covers their hidden coordinates', async () => {
  const bytes = fixture([...firstRow,
    { text: 'GH-3.', x: 10, y: 70 }, { text: '(B)', x: 60, y: 70 },
    { text: 'IJ-4.', x: 150, y: 70 }, { text: '(C)', x: 200, y: 70 },
  ], true);
  const ink = await sharp({ create: { width: 750, height: 40, channels: 3, background: '#000' } }).png().toBuffer();
  const png = await sharp(await painted(bytes)).composite([{ input: ink, left: 25, top: 370 }]).png().toBuffer();
  assert.deepEqual(await readNativeChoiceKeys(bytes, 1, png), { 'AB-17': 'C', 'CD-22': 'A' });
});

void test('invisible native text cannot establish a key table', async () => {
  const bytes = fixture(firstRow);
  const blank = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal(await readNativeChoiceKeys(bytes, 1, blank), null);
});

void test('duplicate full keys are ambiguous even when their printed choices agree', async () => {
  for (const answer of ['C', 'B']) {
    const bytes = fixture([...firstRow, { text: `AB-17. (${answer})`, x: 10, y: 140 }]);
    assert.equal(await readNativeChoiceKeys(bytes, 1, await painted(bytes)), null);
  }
});

void test('worked formulas or prose cannot be partially parsed as a compact choice key', async () => {
  for (const extra of ['AB-17. (C) because the carbonyl reacts', 'AB-17. (C) + H2O', 'AB-17. (C,D)']) {
    const bytes = fixture([{ text: extra, x: 10, y: 170 }, { text: 'CD.22. (A)', x: 10, y: 140 }]);
    assert.equal(await readNativeChoiceKeys(bytes, 1, await painted(bytes)), null);
  }
});

void test('pair ownership requires nearby answer glyphs on the same physical row', async () => {
  const label = firstRow[0];
  assert.ok(label);
  for (const answer of [{ text: '(C)', x: 110, y: 170 }, { text: '(C)', x: 60, y: 160 }]) {
    const bytes = fixture([label, answer, ...firstRow.slice(2)]);
    assert.equal(await readNativeChoiceKeys(bytes, 1, await painted(bytes)), null);
  }
});

void test('bare numeric keys and isolated solution letters do not establish a full-prefix compact table', async () => {
  for (const items of [
    [{ text: '1. (A)', x: 10, y: 170 }, { text: '2. (B)', x: 150, y: 170 }],
    [{ text: 'AB-17. (C)', x: 10, y: 170 }],
  ]) {
    const bytes = fixture(items);
    assert.equal(await readNativeChoiceKeys(bytes, 1, await painted(bytes)), null);
  }
});
