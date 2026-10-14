import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applySmilesPatches,
  auditSmilesCandidates,
  enumerateSmilesCandidates,
  validateSmilesGraph,
} from '../src/infrastructure/ai/chemistry-audit.js';

void test('molecular candidates keep independent ownership across all extraction fields', () => {
  const value = {
    questions: [{
      question_number: 'B-3',
      question_text: 'React <smiles>CCO</smiles> with <smiles>CCO</smiles>.',
      options: ['(A) <smiles>C1CCCC1</smiles>', { label: '5', body: '<smiles>C1CCCCC1</smiles>' }],
      answer: '<smiles>CC=O</smiles>',
      explanation: 'Product <smiles>CC=O</smiles>',
      passage: '<smiles>c1ccccc1</smiles>',
      columns: [{ title: 'Column I', entries: [{ label: 'a', body: '<smiles>CN</smiles>' }] }],
      metadata: '<smiles>CC</smiles>',
    }],
    stem: '<smiles>O</smiles>',
    questionText: '<smiles>N</smiles>',
  };
  const candidates = enumerateSmilesCandidates(value);
  assert.deepEqual(candidates.map(({ id }) => id), [
    '/questions/0/question_text/smiles/0',
    '/questions/0/question_text/smiles/1',
    '/questions/0/options/0/smiles/0',
    '/questions/0/options/1/body/smiles/0',
    '/questions/0/answer/smiles/0',
    '/questions/0/explanation/smiles/0',
    '/questions/0/passage/smiles/0',
    '/questions/0/columns/0/entries/0/body/smiles/0',
    '/stem/smiles/0',
    '/questionText/smiles/0',
  ]);
  assert.equal(candidates[0]?.fieldText, candidates[1]?.fieldText);
});

void test('patch correction changes only owned molecular strings, retaining all question data', async () => {
  const value = {
    questions: [{
      question_number: 'B-3',
      question_text: 'Before <smiles>C1CCCCCC1</smiles> after <smiles>CCO</smiles>.',
      options: [{ label: 'F', body: 'ring <smiles>C1CCCCCC1</smiles>', is_correct: true }],
      answer: 'F',
      match: { a: ['i'] },
      flags: ['review'],
    }],
  };
  const original = structuredClone(value);
  const candidates = enumerateSmilesCandidates(value);
  const result = await applySmilesPatches(value, {
    patches: candidates.map((candidate) => ({
      id: candidate.id,
      smiles: candidate.smiles === 'CCO' ? candidate.smiles : 'C1CCCC1',
    })),
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, 2);
  assert.deepEqual(value, original);
  assert.deepEqual(result.value, {
    questions: [{
      ...original.questions[0],
      question_text: 'Before <smiles>C1CCCC1</smiles> after <smiles>CCO</smiles>.',
      options: [{ label: 'F', body: 'ring <smiles>C1CCCC1</smiles>', is_correct: true }],
    }],
  });
});

void test('model cannot replace JSON, erase questions, or alter extra fields', async () => {
  const value = { question_number: 3, stem: '<smiles>CCO</smiles>', answer: 'A' };
  const candidate = enumerateSmilesCandidates(value)[0];
  assert.ok(candidate);
  for (const response of [
    {},
    { questions: [] },
    { patches: [], stem: '' },
    { patches: [{ id: candidate.id, smiles: 'CC=O', answer: 'B' }] },
    { patches: [{ id: candidate.id, smiles: '</smiles>new prose<smiles>CC' }] },
    { patches: [{ id: candidate.id, smiles: '' }] },
    { patches: [{ id: candidate.id, smiles: 'CCO ethanol' }] },
  ]) {
    const result = await applySmilesPatches(value, response);
    assert.equal(result.ok, false);
    assert.equal(result.value, value);
    assert.equal(result.applied, 0);
    assert.equal(result.diagnostics[0]?.code, 'invalid_response');
  }
});

void test('complete ordered molecular ledger rejects omissions, unknown IDs, duplicates and reorder', async () => {
  const value = { options: ['(A) <smiles>CC</smiles>', '(B) <smiles>CO</smiles>'] };
  const patches = enumerateSmilesCandidates(value).map(({ id, smiles }) => ({ id, smiles }));
  const first = patches[0];
  const second = patches[1];
  assert.ok(first);
  assert.ok(second);
  for (const response of [
    { patches: [] },
    { patches: [first] },
    { patches: [first, { ...second, id: '/unowned/smiles/0' }] },
    { patches: [first, first] },
    { patches: [second, first] },
  ]) {
    const result = await applySmilesPatches(value, response);
    assert.equal(result.ok, false);
    assert.equal(result.value, value);
    assert.equal(result.diagnostics[0]?.code, 'candidate_ledger_mismatch');
  }
});

void test('an invalid molecular correction rejects the whole audit rather than applying part', async () => {
  const value = { stem: '<smiles>CCO</smiles> and <smiles>C1CCCC1</smiles>' };
  const candidates = enumerateSmilesCandidates(value);
  const result = await applySmilesPatches(value, {
    patches: candidates.map(({ id }, index) => ({ id, smiles: index === 0 ? 'CC=O' : 'CN(C)(C)(C)C' })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.value, value);
  assert.equal(result.applied, 0);
  assert.equal(result.diagnostics[0]?.candidateId, candidates[1]?.id);
  assert.equal(result.diagnostics[0]?.code, 'invalid_smiles');
});

void test('RDKit distinguishes ring topology and canonically equivalent molecular graphs', async () => {
  const pentagon = await validateSmilesGraph('C1CCCC1');
  const hexagon = await validateSmilesGraph('C1CCCCC1');
  const fused = await validateSmilesGraph('c1ccc2c(c1)CC(=O)N2');
  const ethanol = await validateSmilesGraph('CCO');
  const reorderedEthanol = await validateSmilesGraph('OCC');
  assert.ok(pentagon.ok && hexagon.ok && fused.ok && ethanol.ok && reorderedEthanol.ok);
  assert.deepEqual(pentagon.graph.ringSizes, [5]);
  assert.deepEqual(hexagon.graph.ringSizes, [6]);
  assert.deepEqual(fused.graph.ringSizes, [5, 6]);
  assert.equal(fused.graph.aromaticAtomCount, 6);
  assert.notEqual(pentagon.graph.graphFingerprint, hexagon.graph.graphFingerprint);
  assert.equal(ethanol.graph.graphFingerprint, reorderedEthanol.graph.graphFingerprint);
  assert.equal(ethanol.graph.atomCount, 3);
  assert.equal(ethanol.graph.bondCount, 2);
  assert.equal(ethanol.graph.componentCount, 1);
});

void test('RDKit identity retains positional isomers, stereochemistry and isotopes', async () => {
  for (const [firstSmiles, secondSmiles] of [
    ['Oc1ccccc1O', 'Oc1cccc(O)c1'],
    ['N[C@H](C)C(=O)O', 'N[C@@H](C)C(=O)O'],
    ['C/C=C/C', 'C/C=C\\C'],
    ['[13CH3]CO', 'CCO'],
  ]) {
    assert.ok(firstSmiles && secondSmiles);
    const first = await validateSmilesGraph(firstSmiles);
    const second = await validateSmilesGraph(secondSmiles);
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.graph.graphFingerprint, second.graph.graphFingerprint);
  }
});

void test('disconnected salts are valid and counted without treating them as missing bonds', async () => {
  const salt = await validateSmilesGraph('[Na+].[O-]C(=O)C');
  assert.ok(salt.ok);
  assert.equal(salt.graph.componentCount, 2);
  assert.equal(salt.graph.formalCharge, 0);
  assert.equal(salt.graph.atomCount, 5);
});

void test('malformed, overvalent, empty and ambiguous graphs stay explicit failures', async () => {
  for (const smiles of ['', 'C1CC', 'CN(C)(C)(C)C', 'c1cccc1', 'CCO ethanol', '<smiles>CCO</smiles>', 'CC>>O']) {
    const result = await validateSmilesGraph(smiles);
    assert.equal(result.ok, false, smiles);
    assert.equal(result.diagnostic.code, 'invalid_smiles');
  }
  const query = await validateSmilesGraph('*CC');
  assert.equal(query.ok, false);
  assert.equal(query.diagnostic.code, 'ambiguous_structure');
});

void test('candidate graph audit reports invalid initial extraction without rewriting source text', async () => {
  const value = { stem: '<smiles>CN(C)(C)(C)C</smiles>', options: ['<smiles>C1CCCC1</smiles>'] };
  const result = await auditSmilesCandidates(value);
  assert.equal(result[0]?.validation.ok, false);
  assert.equal(result[1]?.validation.ok, true);
  assert.equal(value.stem, '<smiles>CN(C)(C)(C)C</smiles>');
});
