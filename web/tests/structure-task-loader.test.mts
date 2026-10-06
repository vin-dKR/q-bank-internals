import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StructureTaskLoader } from '../src/features/ingestion/components/structure-task-loader.js';
import { structureTaskPercent } from '../src/features/ingestion/lib/structure-task-progress.js';

void test('OCR completion reports processed crops and cannot reach 100% before the last crop finishes', () => {
  assert.equal(structureTaskPercent({ completed: 0, total: 8 }), 0);
  assert.equal(structureTaskPercent({ completed: 3, total: 8 }), 37);
  assert.equal(structureTaskPercent({ completed: 7, total: 8 }), 87);
  assert.equal(structureTaskPercent({ completed: 8, total: 8 }), 100);
  assert.equal(structureTaskPercent({ completed: 999, total: 1000 }), 99);
  assert.equal(structureTaskPercent({ completed: 0, total: 0 }), 0);
});

void test('OCR loader exposes its real completion percentage to assistive technology', () => {
  const html = renderToStaticMarkup(
    createElement(StructureTaskLoader, {
      label: 'Running OCR',
      detail: 'OCR crop 4 / 8 · page 2',
      progress: { completed: 3, total: 8 },
    }),
  );
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /3 \/ 8 crops processed/);
  assert.match(html, /OCR crop 4 \/ 8 · page 2/);
});

void test('JSON generation uses completed crops and reserves 100% for the delivered result', () => {
  assert.equal(structureTaskPercent({ completed: 1, total: 3, awaitingResult: true }), 33);
  assert.equal(structureTaskPercent({ completed: 3, total: 3, awaitingResult: true }), 99);
  const html = renderToStaticMarkup(
    createElement(StructureTaskLoader, {
      label: 'Building structure JSON',
      progress: { completed: 3, total: 3, awaitingResult: true },
      progressLabel: 'JSON generation completion',
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /animate-spin/);
  assert.match(html, /Building structure JSON/);
  assert.match(html, /aria-valuenow="99"/);
  assert.match(html, /aria-label="JSON generation completion"/);
  assert.match(html, /3 \/ 3 crops processed/);
});
