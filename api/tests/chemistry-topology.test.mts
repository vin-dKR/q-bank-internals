import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enumerateSmilesCandidates, validateSmilesGraph } from '../src/infrastructure/ai/chemistry-audit.js';
import { applySourceTopologyAudit, graphFromSourceTopology } from '../src/infrastructure/ai/chemistry-topology.schema.js';

function atom(id: number, element = 'C', x = 500, y = 500): { id: number; element: string; x: number; y: number; charge: number; isotope: number; hydrogens: number | null } {
  return { id, element, x, y, charge: 0, isotope: 0, hydrogens: null };
}
function bond(begin: number, end: number, order = 1): { begin: number; end: number; order: number; stereo: string } {
  return { begin, end, order, stereo: 'none' };
}
function polygon(size: number, id = '/stem/smiles/0'): { id: string; readability: string; atoms: ReturnType<typeof atom>[]; bonds: ReturnType<typeof bond>[]; rings: number[][]; notes: string[] } {
  return {
    id, readability: 'clear',
    atoms: Array.from({ length: size }, (_, index) => atom(index + 1, 'C', 500 + 200 * Math.cos(2 * Math.PI * index / size), 500 + 200 * Math.sin(2 * Math.PI * index / size))),
    bonds: Array.from({ length: size }, (_, index) => bond(index + 1, ((index + 1) % size) + 1)),
    rings: [Array.from({ length: size }, (_, index) => index + 1)], notes: [],
  };
}
async function exactGraph(value: unknown, expectedSmiles: string): Promise<void> {
  const actual = await graphFromSourceTopology(value);
  const expected = await validateSmilesGraph(expectedSmiles);
  assert.ok(actual.ok, JSON.stringify(actual));
  assert.ok(expected.ok);
  assert.equal(actual.graph.graphFingerprint, expected.graph.graphFingerprint);
}

void test('source topology derives pentagonal SMILES rather than preserving a valid wrong hexagon', async () => {
  const value = { stem: 'Find <smiles>C1CCCCC1</smiles> product.', answer: 'A', options: ['(A) First'] };
  const original = structuredClone(value);
  const result = await applySourceTopologyAudit(value, { molecules: [polygon(5)], source_counts: [{ field_path: '/stem', observed_molecule_count: 1 }] }, [{ fieldPath: '/stem', moleculeCount: 1 }]);
  assert.equal(result.applied, 1);
  assert.equal(result.value.stem, 'Find <smiles>C1CCCC1</smiles> product.');
  assert.equal(result.audits[0]?.status, 'corrected');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(value, original);
  assert.equal(result.value.answer, original.answer);
  assert.deepEqual(result.value.options, original.options);
});

void test('atom/bond evidence preserves fused five-membered lactam and aromatic benzene', async () => {
  const topology = polygon(6);
  topology.bonds = topology.bonds.map((entry) => ({ ...entry, order: 4 }));
  topology.atoms.push(atom(7, 'C', 750, 300), atom(8, 'C', 850, 500), atom(9, 'N', 750, 700), atom(10, 'O', 1000, 500));
  topology.bonds.push(bond(6, 7), bond(7, 8), bond(8, 9), bond(9, 5), bond(8, 10, 2));
  topology.rings.push([5, 6, 7, 8, 9]);
  await exactGraph(topology, 'c1ccc2c(c1)CC(=O)N2');
});

void test('expanded attached acetyl groups remain acetyl rather than plausible carboxyl', async () => {
  const topology = polygon(6);
  topology.bonds = topology.bonds.map((entry) => ({ ...entry, order: 4 }));
  topology.atoms.push(atom(7, 'N', 750, 500), atom(8, 'C', 850, 500), atom(9, 'O', 850, 350), atom(10, 'C', 1000, 500));
  topology.bonds.push(bond(1, 7), bond(7, 8), bond(8, 9, 2), bond(8, 10));
  await exactGraph(topology, 'CC(=O)Nc1ccccc1');
});

void test('charge, isotope and disconnected salt evidence survive deterministic conversion', async () => {
  await exactGraph({ id: 'a', readability: 'clear', atoms: [{ ...atom(1, 'N'), charge: 1, hydrogens: 4 }], bonds: [], rings: [], notes: [] }, '[NH4+]');
  await exactGraph({ id: 'a', readability: 'clear', atoms: [{ ...atom(1, 'C', 300, 500), isotope: 13, hydrogens: 3 }, atom(2, 'C', 600, 500)], bonds: [bond(1, 2)], rings: [], notes: [] }, '[13CH3]C');
  await exactGraph({ id: 'a', readability: 'clear', atoms: [{ ...atom(1, 'Na', 100, 500), charge: 1 }, { ...atom(2, 'O', 500, 500), charge: -1 }, atom(3, 'C', 700, 500)], bonds: [bond(2, 3)], rings: [], notes: [] }, '[Na+].[O-]C');
});

void test('aromatic explicit NH and positional substituents remain distinct molecular identities', async () => {
  const pyrrole = polygon(5);
  pyrrole.atoms = pyrrole.atoms.map((entry) => entry.id === 1 ? { ...entry, element: 'N', hydrogens: 1 } : entry);
  pyrrole.bonds = pyrrole.bonds.map((entry) => ({ ...entry, order: 4 }));
  await exactGraph(pyrrole, 'c1cc[nH]c1');
  const phenol = polygon(6);
  phenol.bonds = phenol.bonds.map((entry) => ({ ...entry, order: 4 }));
  phenol.atoms.push(atom(7, 'O', 800, 500), atom(8, 'O', 400, 900));
  phenol.bonds.push(bond(1, 7), bond(3, 8));
  await exactGraph(phenol, 'Oc1cccc(O)c1');
  const ortho = { ...phenol, bonds: phenol.bonds.map((entry) => entry.end === 8 ? { ...entry, begin: 2 } : entry) };
  await exactGraph(ortho, 'Oc1ccccc1O');
});

void test('wedge direction and double-bond geometry retain distinct stereochemical graphs', async () => {
  const atoms = [atom(1, 'C', 500, 500), atom(2, 'F', 500, 300), atom(3, 'Cl', 300, 500), atom(4, 'Br', 700, 500)];
  const first = await graphFromSourceTopology({ id: 'a', readability: 'clear', atoms, bonds: [{ ...bond(1, 2), stereo: 'up' }, bond(1, 3), bond(1, 4)], rings: [], notes: [] });
  const second = await graphFromSourceTopology({ id: 'a', readability: 'clear', atoms, bonds: [{ ...bond(1, 2), stereo: 'down' }, bond(1, 3), bond(1, 4)], rings: [], notes: [] });
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.graph.graphFingerprint, second.graph.graphFingerprint);
  assert.match(first.graph.canonicalSmiles, /@/);
  const cisAtoms = [atom(1, 'C', 200, 300), atom(2, 'C', 400, 500), atom(3, 'C', 600, 500), atom(4, 'C', 800, 300)];
  const transAtoms = cisAtoms.map((entry) => entry.id === 4 ? { ...entry, y: 700 } : entry);
  const bonds = [bond(1, 2), bond(2, 3, 2), bond(3, 4)];
  const cis = await graphFromSourceTopology({ id: 'a', readability: 'clear', atoms: cisAtoms, bonds, rings: [], notes: [] });
  const trans = await graphFromSourceTopology({ id: 'a', readability: 'clear', atoms: transAtoms, bonds, rings: [], notes: [] });
  assert.ok(cis.ok && trans.ok);
  assert.notEqual(cis.graph.graphFingerprint, trans.graph.graphFingerprint);
});

void test('topology rejects duplicate atoms, phantom bonds, unsupported elements and invalid ring evidence', async () => {
  const original = polygon(5);
  for (const topology of [
    { ...original, atoms: [...original.atoms, original.atoms[0]] },
    { ...original, bonds: [...original.bonds, bond(1, 2)] },
    { ...original, bonds: [...original.bonds, bond(1, 7)] },
    { ...original, atoms: original.atoms.map((entry) => ({ ...entry, element: 'Qq' })) },
    { ...original, rings: [] },
    { ...original, rings: [[1, 2, 4, 5]] },
    { ...original, rings: [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]] },
    { ...original, notes: ['unreadable attachment'] },
  ]) {
    assert.equal((await graphFromSourceTopology(topology)).ok, false);
  }
});

void test('unreadable candidates remain explicit while other owned structures can be corrected', async () => {
  const value = { stem: '<smiles>C1CCCCCC1</smiles> and <smiles>not-a-molecule</smiles>' };
  const ids = enumerateSmilesCandidates(value).map(({ id }) => id);
  const result = await applySourceTopologyAudit(value, {
    molecules: [polygon(5, ids[0]), { id: ids[1], readability: 'ambiguous', atoms: [], bonds: [], rings: [], notes: ['the fused bond is not visible'] }],
    source_counts: [{ field_path: '/stem', observed_molecule_count: 2 }],
  }, [{ fieldPath: '/stem', moleculeCount: 2 }]);
  assert.equal(result.value.stem, '<smiles>C1CCCC1</smiles> and <smiles>not-a-molecule</smiles>');
  assert.deepEqual(result.audits.map(({ status }) => status), ['corrected', 'unresolved']);
  assert.equal(result.diagnostics[0]?.code, 'ambiguous_structure');
});

void test('source coverage mismatch prevents applying a graph to a missing or merged molecule slot', async () => {
  const value = { stem: '<smiles>C1CCCCCC1</smiles>' };
  const result = await applySourceTopologyAudit(value, { molecules: [polygon(5)], source_counts: [{ field_path: '/stem', observed_molecule_count: 2 }] }, [{ fieldPath: '/stem', moleculeCount: 1 }]);
  assert.equal(result.value.stem, value.stem);
  assert.equal(result.applied, 0);
  assert.equal(result.audits[0]?.status, 'unresolved');
  assert.equal(result.diagnostics[0]?.code, 'source_coverage_mismatch');
});

void test('strict topology response rejects reordered IDs, unknown ownership and prose mutation', async () => {
  const value = { stem: '<smiles>C1CCCCCC1</smiles>', answer: 'A' };
  for (const response of [
    { molecules: [], source_counts: [{ field_path: '/stem', observed_molecule_count: 1 }] },
    { molecules: [polygon(5, '/options/0/smiles/0')], source_counts: [{ field_path: '/stem', observed_molecule_count: 1 }] },
    { molecules: [polygon(5)], source_counts: [] },
    { molecules: [polygon(5)], source_counts: [{ field_path: '/stem', observed_molecule_count: 1 }], answer: 'B' },
  ]) {
    const result = await applySourceTopologyAudit(value, response, [{ fieldPath: '/stem', moleculeCount: 1 }]);
    assert.equal(result.value, value);
    assert.equal(result.audits[0]?.status, 'unresolved');
    assert.equal(result.applied, 0);
  }
});
