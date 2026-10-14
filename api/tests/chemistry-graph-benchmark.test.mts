import assert from 'node:assert/strict';
import test from 'node:test';
import { aliasChemistryGraphResults, ChemistryGraphGoldSchema, ChemistryGraphResultSchema, scoreChemistryGraphs } from '../scripts/chemistry-graph-benchmark.mjs';

async function score(expected: string[], emitted: string[], options?: { image?: boolean; label?: string; wrongOwnership?: boolean }): Promise<Awaited<ReturnType<typeof scoreChemistryGraphs>>> {
  const gold = ChemistryGraphGoldSchema.parse({ schemaVersion: 1, frozenAt: '2026-10-14T00:00:00Z', provenance: 'test source annotation', limitations: [], sources: {}, fields: [{ id: 'owned-structure', split: 'holdout', documentId: 'd', page: 1, printedLabel: 'A-3', field: options?.wrongOwnership ? 'option-A' : 'stem', molecules: expected.map((smiles) => ({ name: smiles, smiles })) }] });
  const text = emitted.map((smiles) => `<smiles>${smiles}</smiles>`).join(' ');
  const results = ChemistryGraphResultSchema.parse([{ documentId: 'd', rows: [{ printedLabel: options?.label ?? 'A-3', sourceRegion: { page: 1 }, stem: options?.wrongOwnership ? '' : text, options: options?.wrongOwnership ? [{ label: 'B', body: text }, { label: 'A', body: '' }] : [], isQuestionImage: options?.image ?? false, questionImage: options?.image ? 'source.png' : null }], drafts: [{ printedLabel: 'A-3', sourcePage: 1, questionText: expected.map((smiles) => `<smiles>${smiles}</smiles>`).join(' '), options: [] }] }]);
  return scoreChemistryGraphs(gold, results, { origin: 'unit-test', goldHash: 'unit-fixture' });
}

await test('canonical molecular equality accepts Kekule or aromatic ring notation', async () => {
  const result = await score(['Oc1ccccc1'], ['OC1=CC=CC=C1']);
  assert.equal(result.production.exactMolecules, 1);
  assert.equal(result.production.exactFieldPercent, 100);
});

await test('valid SMILES with the wrong ring size receives no exact graph credit', async () => {
  const result = await score(['O=C1NCc2ccccc21'], ['O=C1NCCc2ccccc21']);
  assert.equal(result.production.parseValidMolecules, 1);
  assert.equal(result.production.exactMolecules, 0);
});

await test('substituent relocation is a wrong graph even with the same formula', async () => {
  const result = await score(['COc1cccc(O)c1'], ['COc1ccc(O)cc1']);
  assert.equal(result.production.exactMolecules, 0);
});

await test('lost charge, isotope, deuterium, or opposite chirality cannot score exact', async () => {
  const result = await score(['[NH4+]', '[15NH2]c1ccccc1', 'Nc1ccc([2H])cc1', 'N[C@@H](C)C(=O)O'], ['N', 'Nc1ccccc1', 'Nc1ccccc1', 'N[C@H](C)C(=O)O']);
  assert.equal(result.production.exactMolecules, 0);
  assert.equal(result.production.parseValidMolecules, 4);
});

await test('a source crop cannot replace a missing rendered SMILES in the benchmark', async () => {
  const result = await score(['Oc1ccccc1'], [], { image: true });
  assert.equal(result.production.recallPercent, 0);
  assert.equal(result.production.sourceImageFields, 1);
  assert.equal(result.auditCandidates.recallPercent, 100);
});

await test('missing and extra molecules penalize complete field fidelity', async () => {
  const missing = await score(['C', 'CC'], ['C']);
  assert.equal(missing.production.recallPercent, 50);
  assert.equal(missing.production.precisionPercent, 100);
  assert.equal(missing.production.exactFields, 0);
  const extra = await score(['C'], ['C', 'CC']);
  assert.equal(extra.production.precisionPercent, 50);
  assert.equal(extra.production.parseValidMolecules, 2);
  assert.equal(extra.production.extraMolecules, 1);
  assert.equal(extra.production.exactFields, 0);
});

await test('printed question and answer-option ownership are part of graph accuracy', async () => {
  assert.equal((await score(['C'], ['C'], { label: 'B-3' })).production.exactMolecules, 0);
  assert.equal((await score(['C'], ['C'], { wrongOwnership: true })).production.exactMolecules, 0);
});

await test('repeated correctly parsed molecular graphs retain their physical reading order', async () => {
  const result = await score(['C', 'CC'], ['CC', 'C']);
  assert.equal(result.production.parseValidMolecules, 2);
  assert.equal(result.production.exactMolecules, 0);
});

await test('an explicit source alias changes document identity while preserving every molecular field', () => {
  const original = ChemistryGraphResultSchema.parse([{ documentId: 'current-source', rows: [{ printedLabel: 'B-3', sourceRegion: { page: 9 }, stem: '<smiles>C</smiles>', options: [{ label: 'D', body: '<smiles>N</smiles>' }] }], drafts: [] }]);
  const before = structuredClone(original);
  const mapped = aliasChemistryGraphResults(original, new Map([['current-source', 'frozen-reference']]));
  assert.equal(mapped[0]?.documentId, 'frozen-reference');
  assert.deepEqual(mapped[0].rows, original[0]?.rows);
  assert.deepEqual(original, before);
});

await test('source aliases cannot silently merge sources or invent an absent document', () => {
  const original = ChemistryGraphResultSchema.parse([{ documentId: 'a', rows: [], drafts: [] }, { documentId: 'b', rows: [], drafts: [] }]);
  assert.throws(() => aliasChemistryGraphResults(original, new Map([['a', 'b']])), /combine two different/);
  assert.throws(() => aliasChemistryGraphResults(original, new Map([['missing', 'c']])), /no question records/);
});
