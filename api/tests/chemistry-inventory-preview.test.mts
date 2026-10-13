import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createChemistryInventoryPreview } from '../src/infrastructure/ai/chemistry-inventory-preview.js';

async function page(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
}

void test('inventory preview includes axis margins while the complete scaffold fits within 1400 pixels', async () => {
  for (const [width, height] of [[1626, 2300], [2300, 1626], [1800, 1800]]) {
    assert.ok(width && height);
    const source = await page(width, height);
    const preview = await createChemistryInventoryPreview(source);
    const actual = await sharp(preview.png).metadata();
    assert.equal(actual.width, preview.width);
    assert.equal(actual.height, preview.height);
    assert.equal(Math.max(preview.width, preview.height), 1400);
    assert.equal(preview.sourceWidth, width);
    assert.equal(preview.sourceHeight, height);
    assert.ok(preview.sourceFrame.left > 0 && preview.sourceFrame.top > 0);
    assert.ok(preview.sourceFrame.left + preview.sourceFrame.width < preview.width);
    assert.ok(preview.sourceFrame.top + preview.sourceFrame.height < preview.height);
    assert.ok(Math.abs(preview.sourceFrame.width / preview.sourceFrame.height - width / height) < 0.002);
    assert.match(preview.coordinateInstructions, /inner framed source; exclude every outer axis margin/);
    assert.match(preview.coordinateInstructions, /top-left is \[0,0\]; bottom-right is \[1000,1000\]/);
  }
});

void test('localization scaffold preserves original source bytes and does not lighten black ink', async () => {
  const width = 800;
  const height = 1000;
  const ink = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000000' } }).png().toBuffer();
  const source = await sharp(await page(width, height)).composite([{ input: ink, left: 350, top: 450 }]).png().toBuffer();
  const original = Buffer.from(source);
  const preview = await createChemistryInventoryPreview(source);
  assert.deepEqual(source, original);
  assert.equal(preview.sourceFrame.width, width);
  assert.equal(preview.sourceFrame.height, height);
  const blackAtGridCrossing = await sharp(preview.png).extract({ left: preview.sourceFrame.left + 400, top: preview.sourceFrame.top + 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...blackAtGridCrossing], [0, 0, 0]);
  const whiteAwayFromGrid = await sharp(preview.png).extract({ left: preview.sourceFrame.left + 40, top: preview.sourceFrame.top + 50, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...whiteAwayFromGrid], [255, 255, 255]);
  const gridOnWhite = await sharp(preview.png).extract({ left: preview.sourceFrame.left + 80, top: preview.sourceFrame.top + 50, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(gridOnWhite.some((channel) => channel < 255));
  const sourceAfter = await sharp(source).metadata();
  assert.equal(sourceAfter.width, width);
  assert.equal(sourceAfter.height, height);
});

void test('preview has readable axis ink outside the untouched source frame', async () => {
  const source = await page(800, 1000);
  const preview = await createChemistryInventoryPreview(source);
  const topAxis = await sharp(preview.png).extract({ left: preview.sourceFrame.left, top: preview.sourceFrame.top - 26, width: preview.sourceFrame.width, height: 18 }).removeAlpha().raw().toBuffer();
  assert.ok(topAxis.some((channel) => channel < 200));
  const leftAxis = await sharp(preview.png).extract({ left: 0, top: preview.sourceFrame.top, width: preview.sourceFrame.left - 4, height: preview.sourceFrame.height }).removeAlpha().raw().toBuffer();
  assert.ok(leftAxis.some((channel) => channel < 200));
});
