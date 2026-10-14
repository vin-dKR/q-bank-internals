import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readNativePageLayout, pageLayoutFromOcr } from '../src/infrastructure/pdf/page-layout.js';
import type { OcrLine } from '../src/modules/ingestion/index.js';

function clippedPdf(): Buffer {
  const form = 'BT /F1 8 Tf 10 75 Td (A-1.) Tj ET\nBT /F1 8 Tf 10 20 Td (B-1.) Tj ET';
  const content = '/Fm Do';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Fm 6 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Form /BBox [0 50 100 100] /Resources << /Font << /F1 4 0 R >> >> /Length ${String(form.length)} >>\nstream\n${form}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  result += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(start)}\n%%EOF`;
  return Buffer.from(result);
}

async function painted(rectangles: Array<{ left: number; top: number; width: number; height: number }>): Promise<Buffer> {
  const ink = await Promise.all(rectangles.map(async (rect) => ({
    input: await sharp({ create: { width: rect.width, height: rect.height, channels: 3, background: '#000' } }).png().toBuffer(),
    left: rect.left, top: rect.top,
  })));
  return sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#fff' } }).composite(ink).png().toBuffer();
}

function line(text: string, left: number, top: number, right: number, bottom: number): OcrLine {
  return { text, confidence: 99, box: { left, top, right, bottom } };
}

void test('native anchors discard split-PDF hidden text even when unrelated raster ink covers its coordinates', async () => {
  const bytes = clippedPdf();
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    assert.ok(text.items.some((item) => 'str' in item && item.str === 'B-1.'), 'PDFjs exposes the clipped hidden label');
  } finally {
    await document.destroy();
  }
  const png = await painted([
    { left: 100, top: 180, width: 120, height: 40 },
    { left: 100, top: 730, width: 120, height: 40 },
  ]);
  const layout = await readNativePageLayout(bytes, 1, png);
  assert.ok(layout);
  assert.deepEqual(layout.questions.map((question) => question.printedLabel), ['A-1']);
  assert.equal(layout.contentBox[3], 0.5);
  assert.ok(layout.questions.every((question) => question.bbox[3] <= 0.5));
});

void test('a text anchor without rendered ink never becomes a visible question', async () => {
  const png = await painted([]);
  assert.equal(await readNativePageLayout(clippedPdf(), 1, png), null);
});

void test('raster gutters preserve drawings above question labels and prevent neighboring ownership', async () => {
  const png = await painted([
    { left: 50, top: 200, width: 60, height: 20 },
    { left: 300, top: 180, width: 3, height: 220 },
    { left: 50, top: 500, width: 60, height: 20 },
    { left: 300, top: 450, width: 3, height: 100 },
  ]);
  const layout = await pageLayoutFromOcr(png, [line('A-1.', 50, 200, 110, 220), line('A-2.', 50, 500, 110, 520)]);
  assert.ok(layout);
  const [first, second] = layout.questions;
  assert.ok(first && second);
  assert.ok(first.bbox[1] < 0.18, 'the first ring begins before its question label');
  assert.ok(second.bbox[1] > 0.4 && second.bbox[1] < 0.45, 'the boundary lies in the actual white gutter');
  assert.equal(first.bbox[3], second.bbox[1]);
  assert.ok(second.bbox[1] < second.anchorBox[1]);
});

void test('native-style option anchors exclude reaction intermediates and preserve a two-row panel', async () => {
  const lines = [line('B-1.', 50, 100, 110, 120), line('(A)', 300, 180, 330, 200), line('(A)', 100, 300, 130, 320), line('(B)', 550, 300, 580, 320), line('(C)', 100, 500, 130, 520), line('(D)', 550, 500, 580, 520)];
  const png = await painted([
    ...lines.map((value) => ({ left: value.box.left, top: value.box.top, width: value.box.right - value.box.left, height: value.box.bottom - value.box.top })),
    { left: 200, top: 260, width: 3, height: 140 },
    { left: 650, top: 260, width: 3, height: 140 },
    { left: 200, top: 450, width: 3, height: 140 },
    { left: 650, top: 450, width: 3, height: 140 },
  ]);
  const layout = await pageLayoutFromOcr(png, lines);
  const question = layout?.questions[0];
  assert.ok(question);
  assert.deepEqual(question.options.map((option) => option.label), ['A', 'B', 'C', 'D']);
  assert.ok(question.stemBbox && question.stemBbox[3] > 0.2 && question.stemBbox[3] < 0.26);
  const [a, b, c, d] = question.options;
  assert.ok(a && b && c && d);
  assert.equal(a.bbox[2], b.bbox[0]);
  assert.equal(a.bbox[3], c.bbox[1]);
  assert.ok(a.bbox[1] < 0.26 && c.bbox[1] < 0.45, 'option bonds above their labels stay inside their panels');
});

void test('inline reaction condition numbers do not split a chemistry page into false columns', async () => {
  const lines = [
    line('3.', 80, 100, 105, 120), line('(A)', 140, 190, 170, 210), line('(B)', 560, 190, 590, 210), line('(C)', 140, 270, 170, 290), line('(D)', 560, 270, 590, 290),
    line('4.', 80, 350, 105, 370), line('1. CCl4 + NaOH', 280, 390, 420, 410), line('2. H+', 280, 420, 340, 440),
    line('5.', 80, 520, 105, 540), line('(A)', 140, 620, 170, 640), line('(B)', 560, 620, 590, 640), line('(C)', 140, 730, 170, 750), line('(D)', 560, 730, 590, 750),
  ];
  const png = await painted(lines.map((value) => ({ left: value.box.left, top: value.box.top, width: value.box.right - value.box.left, height: value.box.bottom - value.box.top })));
  const layout = await pageLayoutFromOcr(png, lines);
  assert.ok(layout);
  assert.deepEqual(layout.questions.map((question) => question.printedLabel), ['3', '4', '5']);
  assert.deepEqual(layout.questions[0]?.options.map((option) => option.label), ['A', 'B', 'C', 'D']);
  assert.deepEqual(layout.questions[2]?.options.map((option) => option.label), ['A', 'B', 'C', 'D']);
});

void test('numbered product illustrations do not become a second source question', async () => {
  const lines = [
    line('7.', 80, 500, 105, 520), line('How many of the following products (1 - 9) can be formed.', 140, 500, 600, 520),
    line('9)', 620, 510, 650, 530),
  ];
  const png = await painted(lines.map((value) => ({ left: value.box.left, top: value.box.top, width: value.box.right - value.box.left, height: value.box.bottom - value.box.top })));
  const layout = await pageLayoutFromOcr(png, lines);
  assert.ok(layout);
  assert.deepEqual(layout.questions.map((question) => question.printedLabel), ['7']);
});
