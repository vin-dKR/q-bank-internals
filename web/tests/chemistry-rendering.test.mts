import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMathToHtml } from '../src/shared/lib/katex-setup.js';
import { chemistrySourceReviewBlockers } from '../src/features/questions/lib/chemistry-source-review.js';
import { chemistryResultText } from '../src/features/questions/lib/chemistry-result-text.js';
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
    answer: '', explanation: null, answerImages: [], explanationImages: [], match: null, passageId: null,
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

void test('the visible review preflight catches unverified solutions, answers, matrices and shared passages', () => {
  const cropUrl = 'https://example.test/question.png';
  const question: Parameters<typeof chemistrySourceReviewBlockers>[0] = {
    chemistry: {
      version: 1, status: 'needs_review', issues: [], candidateStem: 'Find the product <smiles>C1CC1</smiles>', candidateOptions: [],
      visuals: [{ id: 'stem', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CC1'], graphValid: true, cropUrl }],
    },
    stem: 'Find the product [See source diagram]', options: [], questionImage: cropUrl, isQuestionImage: true,
    optionImages: [], isOptionImage: false, answer: '', explanation: null, answerImages: [], explanationImages: [], match: null, passageId: null,
  };
  assert.deepEqual(chemistrySourceReviewBlockers(question), []);
  assert.ok(chemistrySourceReviewBlockers({ ...question, explanation: 'Product: <smiles>C1CC1</smiles>' }).some((blocker) => blocker.includes('worked solution')));
  assert.ok(chemistrySourceReviewBlockers({ ...question, answer: '<smiles>C1CC1</smiles>' }).some((blocker) => blocker.includes('answer')));
  assert.ok(chemistrySourceReviewBlockers({ ...question, match: { columns: [{ title: '<smiles>C</smiles>', entries: [] }, { title: 'Products', entries: [] }], key: {} } }).some((blocker) => blocker.includes('matrix column')));
  assert.ok(chemistrySourceReviewBlockers({ ...question, passageId: 'passage' }, { text: '<smiles>C</smiles>', passageImage: cropUrl }).some((blocker) => blocker.includes('shared passage')));
  assert.ok(chemistrySourceReviewBlockers({ ...question, passageId: 'passage' }).some((blocker) => blocker.includes('missing')));
});

void test('legacy source-owned fields show readable extracted text without molecular guesses or silent writes', () => {
  const cropUrl = 'https://example.test/question.png';
  const question: Parameters<typeof chemistryResultText>[0] = {
    options: [{ label: 'B', body: '', isCorrect: false }],
    chemistry: {
      version: 1, status: 'needs_review', issues: [],
      candidateStem: String.raw`Write the product <smiles>C1CC1</smiles> \(\ce{->[HBr]}\)`,
      candidateOptions: ['(B) Product <smiles>C1CC1</smiles>'],
      visuals: [{ id: 'stem', field: 'stem', optionLabel: null, kind: 'reaction', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CC1'], graphValid: true, cropUrl }],
    },
  };
  assert.equal(chemistryResultText(question, 'stem', ''), String.raw`Write the product [See source diagram] \(\ce{->[HBr]}\)`);
  assert.equal(chemistryResultText(question, 'option', '', 0), '', 'Unattached audit candidates do not become displayed choices.');
  assert.ok(question.chemistry);
  const sourceOption: Parameters<typeof chemistryResultText>[0] = { ...question, chemistry: { ...question.chemistry, visuals: [{ id: 'option', field: 'option', optionLabel: 'B', kind: 'molecule', bbox: [0, 0, 0.2, 0.2], candidateSmiles: ['C1CC1'], graphValid: true, cropUrl }] } };
  assert.equal(chemistryResultText(sourceOption, 'option', '', 0), 'Product [See source diagram]');
  assert.equal(chemistryResultText(question, 'stem', 'My corrected text'), 'My corrected text');
  assert.equal(chemistryResultText({ ...question, chemistry: null }, 'stem', '<smiles>C1CC1</smiles>'), '<smiles>C1CC1</smiles>', 'Ordinary extraction keeps its existing rendering behavior.');
});
