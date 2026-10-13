import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMathToHtml } from '../src/shared/lib/katex-setup.js';
import { chemistrySourceReviewBlockers } from '../src/features/questions/lib/chemistry-source-review.js';
import type { ChemistryExtraction } from '@ingest/contracts';

void test('reaction arrows, conditions, equilibrium and charges render through the mhchem-enabled instance', () => {
  for (const reaction of [
    String.raw`\ce{C6H5CONH2 ->[Br2/NaOH] C6H5NH2}`,
    String.raw`\ce{A ->[CH3COCl][reflux] B}`,
    String.raw`\ce{NH4+ + OH- <=> NH3 + H2O}`,
  ]) {
    const html = renderMathToHtml(reaction, false);
    assert.match(html, /katex/);
    assert.doesNotMatch(html, /katex-error|Undefined control sequence/);
  }
  assert.match(renderMathToHtml(String.raw`\ce{A ->[Br2/NaOH] B}`, false), /NaOH/);
});

void test('source review requires complete crops assigned to their original choices; graph validity cannot replace them', () => {
  const cropUrl = 'https://example.test/option-C.png';
  const chemistry: ChemistryExtraction = {
    version: 1, status: 'needs_review', issues: [], candidateStem: '', candidateOptions: ['text', '<smiles>C1CCC</smiles>'],
    visuals: [{ id: 'c', field: 'option', optionLabel: '(c)', kind: 'molecule', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CCC'], graphValid: false, cropUrl }],
  };
  const visual = chemistry.visuals[0];
  assert.ok(visual);
  const question: Parameters<typeof chemistrySourceReviewBlockers>[0] = {
    stem: '', options: [{ label: 'A', body: 'text', isCorrect: false }, { label: 'C', body: '', isCorrect: true }],
    questionImage: null, isQuestionImage: false, optionImages: ['', cropUrl], isOptionImage: true,
    chemistry,
  };
  assert.deepEqual(chemistrySourceReviewBlockers(question), [], 'An incorrect graph candidate is harmless when the matching source crop is authoritative.');
  assert.ok(chemistrySourceReviewBlockers({ ...question, optionImages: [cropUrl, ''] }).length > 0, 'A crop in the wrong choice slot must block review.');
  assert.ok(chemistrySourceReviewBlockers({ ...question, isOptionImage: false }).length > 0, 'A hidden source figure must block review.');
  assert.ok(chemistrySourceReviewBlockers({ ...question, options: [{ label: 'A', body: 'text', isCorrect: false }, { label: 'C', body: '<smiles>C1CCC</smiles>', isCorrect: true }] }).length > 0, 'Unverified diagram text alongside a complete crop must block review.');
  assert.ok(chemistrySourceReviewBlockers({ ...question, chemistry: { ...chemistry, visuals: [{ ...visual, cropUrl: null, graphValid: true }] } }).length > 0, 'A valid graph must never waive the required source crop.');
  const stem = { ...question, questionImage: cropUrl, isQuestionImage: true, chemistry: { ...chemistry, visuals: [{ ...visual, field: 'stem' as const, optionLabel: null }] } };
  assert.deepEqual(chemistrySourceReviewBlockers(stem), []);
  assert.ok(chemistrySourceReviewBlockers({ ...stem, stem: 'Candidate text' }).length > 0);
  assert.ok(chemistrySourceReviewBlockers({ ...stem, questionImage: `${cropUrl},https://example.test/extra.png` }).length > 0);
  const regions: [number, number, number, number][] = [[0, 0, 0.2, 0.2], [0.5, 0, 0.2, 0.2]];
  const continued = { ...stem, chemistry: { ...stem.chemistry, visuals: [{ ...visual, field: 'stem' as const, optionLabel: null, regions }] } };
  assert.deepEqual(chemistrySourceReviewBlockers(continued), [], 'A composite keeps one authoritative field URL while retaining its separate physical regions.');
  assert.ok(chemistrySourceReviewBlockers({ ...continued, questionImage: null }).length > 0, 'Multi-region metadata cannot waive the displayed composite source image.');
});
