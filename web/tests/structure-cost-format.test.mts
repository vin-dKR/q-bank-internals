import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatStructureCostInr } from '../src/features/ingestion/lib/structure-cost-format.js';

void test('USD estimates and reported PDF costs display in INR using the supplied exchange rate', () => {
  assert.equal(formatStructureCostInr(0.0239, 96.27), '₹2.30');
  assert.equal(formatStructureCostInr(0.8349, 96.27), '₹80.38');
  assert.equal(formatStructureCostInr(0.0855, 96.27), '₹8.23');
});

void test('cached zero-cost runs stay zero and large costs use Indian digit grouping', () => {
  assert.equal(formatStructureCostInr(0, 96.27), '₹0.00');
  assert.equal(formatStructureCostInr(10000, 96.27), '₹9,62,700.00');
  assert.equal(formatStructureCostInr(1, 90), '₹90.00');
});
