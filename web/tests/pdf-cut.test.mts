import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFRawStream, PageSizes, StandardFonts } from 'pdf-lib';
import { applyGridSplit } from '../src/features/ingestion/lib/apply-grid-split.js';
import { cellBounds } from '../src/features/ingestion/lib/cut-pdf.js';
import type { SplitPointsByPage } from '../src/features/ingestion/types/split-point.js';

async function sourcePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jucQAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  for (let number = 1; number <= pageCount; number++) {
    const page = doc.addPage([600, 800]);
    page.drawText(`Heading ${String(number)}`, { x: 20, y: 700, font });
    page.drawText(`Question ${String(number)}`, { x: 20, y: 200, font });
    page.drawImage(image, { x: 50, y: 500, width: 100, height: 100 });
  }
  return doc.save();
}

function imageCount(doc: PDFDocument): number {
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    ).length;
}

void test('horizontal clipping uses PDF coordinates and rejects zero-area cells', () => {
  assert.deepEqual(
    cellBounds({ width: 600, height: 800 }, { pageNumber: 1, start: 0, end: 0.25 }),
    { left: 0, right: 600, bottom: 600, top: 800 },
  );
  assert.equal(
    cellBounds({ width: 600, height: 800 }, { pageNumber: 1, start: 0.5, end: 0.5 }),
    null,
  );
});

void test('cutting one page preserves uncut page sizes and shares images across the document', async () => {
  const source = await sourcePdf(20);
  const original = await PDFDocument.load(source);
  const output = await PDFDocument.load(
    await applyGridSplit(source, {
      1: [{ id: 'horizontal', orientation: 'horizontal', position: 0.25 }],
    }),
  );
  assert.equal(output.getPageCount(), 21);
  assert.deepEqual(output.getPage(0).getSize(), {
    width: PageSizes.A4[0],
    height: PageSizes.A4[1],
  });
  assert.deepEqual(output.getPage(2).getSize(), { width: 600, height: 800 });
  assert.equal(imageCount(output), imageCount(original));
});

void test('all-page and repeated cuts do not duplicate shared image streams', async () => {
  const source = await sourcePdf(20);
  const original = await PDFDocument.load(source);
  const splits: SplitPointsByPage = {};
  for (let page = 1; page <= 20; page++)
    splits[page] = [{ id: String(page), orientation: 'horizontal', position: 0.5 }];
  const cut = await applyGridSplit(source, splits);
  const output = await PDFDocument.load(cut);
  assert.equal(output.getPageCount(), 40);
  assert.equal(imageCount(output), imageCount(original));
  const repeated = await PDFDocument.load(
    await applyGridSplit(cut, {
      1: [{ id: 'vertical', orientation: 'vertical', position: 0.5 }],
    }),
  );
  assert.equal(repeated.getPageCount(), 41);
  assert.equal(imageCount(repeated), imageCount(original));
});
