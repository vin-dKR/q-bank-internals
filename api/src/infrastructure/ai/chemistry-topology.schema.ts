import { z } from 'zod';
import {
  enumerateMolecularFields, enumerateSmilesCandidates, replaceOwnedSmilesTokens, validateMolfileGraph, validateSmilesGraph,
  type ChemistryDiagnostic, type MolecularGraph,
} from './chemistry-audit.js';

const MAX_ATOMS = 512;
const MAX_BONDS = 1024;
const AtomSchema = z.object({
  id: z.number().int().min(1).max(MAX_ATOMS),
  element: z.string().regex(/^[A-Z][a-z]?$/),
  x: z.number().min(0).max(1000),
  y: z.number().min(0).max(1000),
  charge: z.number().int().min(-8).max(8),
  isotope: z.number().int().min(0).max(300),
  hydrogens: z.number().int().min(0).max(8).nullable(),
}).strict();
const BondSchema = z.object({
  begin: z.number().int().min(1).max(MAX_ATOMS),
  end: z.number().int().min(1).max(MAX_ATOMS),
  order: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  stereo: z.enum(['none', 'up', 'down']),
}).strict();
const MoleculeTopologySchema = z.object({
  id: z.string().min(1),
  readability: z.enum(['clear', 'ambiguous', 'unreadable']),
  atoms: z.array(AtomSchema).max(MAX_ATOMS),
  bonds: z.array(BondSchema).max(MAX_BONDS),
  rings: z.array(z.array(z.number().int().min(1).max(MAX_ATOMS)).min(3).max(MAX_ATOMS)).max(MAX_ATOMS),
  notes: z.array(z.string()).max(20),
}).strict();

export const ChemistryTopologyResponseSchema = z.object({
  molecules: z.array(MoleculeTopologySchema),
  source_counts: z.array(z.object({ field_path: z.string().min(1), observed_molecule_count: z.number().int().min(0).max(MAX_ATOMS) }).strict()),
}).strict();
type MoleculeTopology = z.infer<typeof MoleculeTopologySchema>;

export type MolecularTopologyAudit = {
  candidateId: string;
  fieldPath: string;
  status: 'matched' | 'corrected' | 'unresolved';
  message: string;
  canonicalSmiles?: string;
  graphFingerprint?: string;
};
export type ChemistrySourceScope = { fieldPath: string; moleculeCount: number };
type MolecularSourceField = ChemistrySourceScope & { fieldText: string };

/** A declared drawing is still audited when the primary reader omitted its molecular token. */
export function declaredMolecularSourceFields(value: unknown): MolecularSourceField[] {
  const fields: MolecularSourceField[] = [];
  const visit = (child: unknown, path: string): void => {
    if (Array.isArray(child)) { child.forEach((entry: unknown, index) => { visit(entry, `${path}/${String(index)}`); }); return; }
    if (child === null || typeof child !== 'object') return;
    // Object.entries is the runtime boundary for an unknown model JSON object.
    const entries: Array<[string, unknown]> = Object.entries(child);
    const record = new Map(entries);
    for (const field of ['answer', 'explanation'] as const) {
      const kind = record.get(`${field}_visual_kind`);
      if (kind !== 'molecule' && kind !== 'reaction') continue;
      const text = record.get(field);
      const fieldText = typeof text === 'string' ? text : '';
      fields.push({ fieldPath: `${path}/${field}`, fieldText, moleculeCount: enumerateSmilesCandidates({ stem: fieldText }).length });
    }
    for (const [key, entry] of entries) visit(entry, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  };
  visit(value, '');
  return fields;
}

export function answerSourceOwnership(value: unknown): string[] {
  const owners: string[] = [];
  const visit = (child: unknown, path: string, key: string, sourceSection: string): void => {
    if (Array.isArray(child)) { child.forEach((entry: unknown, index) => { visit(entry, `${path}/${String(index)}`, String(index), sourceSection); }); return; }
    if (child === null || typeof child !== 'object') return;
    const entries: Array<[string, unknown]> = Object.entries(child);
    const record = new Map(entries);
    const section = record.get('section_name');
    const printedScope = record.has('section_name') ? typeof section === 'string' ? section.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '' : sourceSection;
    for (const [entryKey, entry] of entries) {
      const entryPath = `${path}/${entryKey.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (key === 'answers' || key === 'solutions') owners.push(JSON.stringify([printedScope, entryPath]));
      visit(entry, entryPath, entryKey, printedScope);
    }
  };
  visit(value, '', '', '');
  return owners;
}

export function molecularTextAtPointer(value: unknown, path: string): string {
  let current: unknown = value;
  for (const part of path.split('/').slice(1).map((entry) => entry.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (Array.isArray(current)) current = /^\d+$/.test(part) ? current[Number(part)] : undefined;
    else if (current !== null && typeof current === 'object') current = new Map<string, unknown>(Object.entries(current)).get(part);
    else return '';
  }
  return typeof current === 'string' ? current : '';
}

export function prepareSourceTopologyAudit(value: unknown, sourceImageForField: (fieldPath: string) => string, includeField?: (fieldPath: string) => boolean, additionalFields: MolecularSourceField[] = []): {
  scopes: ChemistrySourceScope[];
  candidateLedger: Array<{ id: string; fieldPath: string; index: number; fieldText: string; sourceImage: string }>;
  sourceScopes: Array<{ fieldPath: string; fieldText: string; candidateCount: number; sourceImage: string }>;
} {
  const redact = (text: string): string => text.replace(/<smiles>[\s\S]*?<\/smiles>/g, '[MOLECULE]');
  const fields = enumerateMolecularFields(value).filter((field) => field.moleculeCount > 0 || includeField?.(field.fieldPath));
  for (const field of additionalFields) if (!fields.some((entry) => entry.fieldPath === field.fieldPath)) fields.push(field);
  return {
    scopes: fields.map(({ fieldPath, moleculeCount }) => ({ fieldPath, moleculeCount })),
    candidateLedger: enumerateSmilesCandidates(value).map(({ id, fieldPath, index, fieldText }) => ({ id, fieldPath, index, fieldText: redact(fieldText), sourceImage: sourceImageForField(fieldPath) })),
    sourceScopes: fields.map(({ fieldPath, fieldText, moleculeCount }) => ({ fieldPath, fieldText: redact(fieldText), candidateCount: moleculeCount, sourceImage: sourceImageForField(fieldPath) })),
  };
}

/** This response is independent evidence: it cannot return prose, SMILES or question JSON. */
export const CHEMISTRY_TOPOLOGY_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'chemistry_visible_topology', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['molecules', 'source_counts'],
      properties: {
        molecules: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'readability', 'atoms', 'bonds', 'rings', 'notes'],
          properties: {
            id: { type: 'string' }, readability: { type: 'string', enum: ['clear', 'ambiguous', 'unreadable'] },
            atoms: { type: 'array', items: {
              type: 'object', additionalProperties: false,
              required: ['id', 'element', 'x', 'y', 'charge', 'isotope', 'hydrogens'],
              properties: {
                id: { type: 'integer' }, element: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
                charge: { type: 'integer' }, isotope: { type: 'integer' }, hydrogens: { type: ['integer', 'null'] },
              },
            } },
            bonds: { type: 'array', items: {
              type: 'object', additionalProperties: false, required: ['begin', 'end', 'order', 'stereo'],
              properties: { begin: { type: 'integer' }, end: { type: 'integer' }, order: { type: 'integer', enum: [1, 2, 3, 4] }, stereo: { type: 'string', enum: ['none', 'up', 'down'] } },
            } },
            rings: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
            notes: { type: 'array', items: { type: 'string' } },
          },
        } },
        source_counts: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['field_path', 'observed_molecule_count'],
          properties: { field_path: { type: 'string' }, observed_molecule_count: { type: 'integer' } },
        } },
      },
    },
  },
};

export const CHEMISTRY_TOPOLOGY_AUDIT_PROMPT = `Independently transcribe molecular drawings from source pixels into atom/bond graphs. You are NOT asked to write SMILES or solve the reaction. The initial molecule tokens are deliberately hidden. Each candidate ID belongs to a fixed text field and its zero-based molecule ordinal in printed reading order. Use its assigned source image and surrounding prose to locate that exact molecule. Return EVERY supplied candidate ID once, in exactly the supplied order. Never change ownership, question labels, prose, reactions, options, or answers.
For each clearly readable molecule, trace every visible endpoint, corner, ring vertex, fused bond, heteroatom, carbonyl and substituent. An unlabeled endpoint/corner is carbon. Expand printed attached groups such as CH3, COCH3, NHCOCH3 and SO3H into their full atom/bond connectivity; do not replace acetyl with carboxyl. A salt may have disconnected components. For aromatic circles use aromatic order 4 for all ring bonds; for an explicitly alternating ring preserve the drawn single/double bonds. Keep formal charges and isotope labels exactly. Count each printed ring with its vertex IDs in cyclic order, without repeating the first vertex. A pentagon has FIVE vertices, including fused vertices; a hexagon has SIX. List the visible constituent rings, not arbitrary large cycles around multiple fused rings.
Atoms: integer ID starting at 1; element symbol; x/y on this source image's 0–1000 axes (x right, y down); formal charge (0 when absent); isotope mass (0 when absent); hydrogens null for normal implicit valence, explicit count only when the drawing requires it (for example aromatic NH or a charged hydrogen-bearing nitrogen). Include an explicit isotope-labeled hydrogen/deuterium as its own atom. Bonds: begin/end atom IDs; order 1/2/3/4; stereo none/up/down. Wedge up/down means the narrow endpoint is begin and the wide endpoint is end; copy wedge/dash direction exactly. Preserve the actual 2-D geometry around double bonds, so the deterministic chemistry engine can recover E/Z. Never invent stereochemistry absent from the drawing.
If ANY connectivity, ring vertex, substituent placement, charge or stereochemical mark cannot be read confidently, use readability ambiguous or unreadable, notes describing the specific missing evidence, and empty atoms/bonds/rings. An atom-adjacent star (*) without a printed isotope mass or a clear legend is an unresolved source annotation: never invent mass 13/14, a wildcard atom, or stereochemistry, and never silently erase that mark. Describe its exact atom/position in notes and use readability ambiguous because this graph schema cannot represent its unspecified meaning. Do not fill a plausible graph. Clear entries use notes [] and must have a complete graph.
For EVERY source field in SOURCE SCOPES, independently count all drawn molecular structures, including reaction reactants, intermediates, products and multiple structures inside one option. Do not count a printed formula/reagent name lacking drawn connectivity as a diagram. Return source_counts in supplied field order. If the count differs from the candidate count, report the observed count; do not force agreement or invent IDs.
Return only {"molecules":[{"id":"...","readability":"clear","atoms":[{"id":1,"element":"C","x":0,"y":0,"charge":0,"isotope":0,"hydrogens":null}],"bonds":[],"rings":[],"notes":[]}],"source_counts":[{"field_path":"...","observed_molecule_count":1}]}.
`;

const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
function edgeKey(first: number, second: number): string {
  return first < second ? `${String(first)}:${String(second)}` : `${String(second)}:${String(first)}`;
}
function topologyIssue(topology: MoleculeTopology): string | null {
  if (topology.atoms.length === 0) return 'A clear topology contains no atoms.';
  const ids = new Set(topology.atoms.map((atom) => atom.id));
  if (ids.size !== topology.atoms.length) return 'Atom IDs are duplicated.';
  if (topology.atoms.some((atom, index) => atom.id !== index + 1 || !ELEMENTS.has(atom.element))) return 'Atom IDs must be consecutive in order, with real element symbols.';
  const bonds = new Set<string>();
  for (const bond of topology.bonds) {
    const key = edgeKey(bond.begin, bond.end);
    if (bond.begin === bond.end || !ids.has(bond.begin) || !ids.has(bond.end) || bonds.has(key)) return 'A bond has an unknown, repeated or identical endpoint.';
    if (bond.stereo !== 'none' && bond.order !== 1) return 'Wedge/dash evidence must belong to a single bond.';
    bonds.add(key);
  }
  const ringKeys = new Set<string>();
  for (const ring of topology.rings) {
    if (new Set(ring).size !== ring.length || ring.some((id) => !ids.has(id))) return 'Ring evidence contains repeated or unknown vertices.';
    if (ring.some((id, index) => !bonds.has(edgeKey(id, ring[(index + 1) % ring.length] ?? 0)))) return 'A claimed ring does not form a closed bonded cycle.';
    const key = [...ring].sort((first, second) => first - second).join(':');
    if (ringKeys.has(key)) return 'The same ring is reported more than once.';
    ringKeys.add(key);
  }
  if (topology.notes.length > 0) return 'A topology with unresolved evidence cannot be labeled clear.';
  return null;
}

function molfile(topology: MoleculeTopology): string {
  const expandedAtoms = [...topology.atoms];
  const expandedBonds = [...topology.bonds];
  // V3000 HCOUNT describes a substructure query, not a molecule's explicit hydrogens. Real H atoms
  // avoid accepting a query whose exported SMILES silently loses aromatic NH or a hydrogen count.
  for (const atom of topology.atoms) {
    for (let count = 0; count < (atom.hydrogens ?? 0); count += 1) {
      const id = expandedAtoms.length + 1;
      expandedAtoms.push({ id, element: 'H', x: atom.x + 0.01 * (count + 1), y: atom.y + 0.01, charge: 0, isotope: 0, hydrogens: null });
      expandedBonds.push({ begin: atom.id, end: id, order: 1, stereo: 'none' });
    }
  }
  const atoms = expandedAtoms.map((atom) => {
    const attached = expandedBonds.filter((bond) => bond.begin === atom.id || bond.end === atom.id);
    const valence = atom.hydrogens === 0 && attached.every((bond) => bond.order !== 4) ? attached.reduce((sum, bond) => sum + bond.order, 0) : null;
    const attributes = [atom.charge ? `CHG=${String(atom.charge)}` : '', atom.isotope ? `MASS=${String(atom.isotope)}` : '', valence !== null ? `VAL=${String(valence === 0 ? -1 : valence)}` : ''].filter(Boolean);
    return `M  V30 ${String(atom.id)} ${atom.element} ${(atom.x / 100).toFixed(4)} ${(-atom.y / 100).toFixed(4)} 0 0${attributes.length ? ` ${attributes.join(' ')}` : ''}`;
  });
  const bonds = expandedBonds.map((bond, index) => `M  V30 ${String(index + 1)} ${String(bond.order)} ${String(bond.begin)} ${String(bond.end)}${bond.stereo === 'none' ? '' : ` CFG=${bond.stereo === 'up' ? '1' : '3'}`}`);
  return ['Source topology', '  source  2D', '', '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB', `M  V30 COUNTS ${String(atoms.length)} ${String(bonds.length)} 0 0 0`, 'M  V30 BEGIN ATOM', ...atoms, 'M  V30 END ATOM', 'M  V30 BEGIN BOND', ...bonds, 'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', ''].join('\n');
}

/** A model-supplied topology is evidence only after ownership, cycles, valence and stereo survive parsing. */
export async function graphFromSourceTopology(value: unknown): Promise<{ ok: true; graph: MolecularGraph } | { ok: false; diagnostic: ChemistryDiagnostic }> {
  const parsed = MoleculeTopologySchema.safeParse(value);
  if (!parsed.success) return { ok: false, diagnostic: { code: 'invalid_topology', message: 'The atom/bond topology does not match the strict schema.' } };
  const topology = parsed.data;
  if (topology.readability !== 'clear') return { ok: false, diagnostic: { code: 'ambiguous_structure', message: topology.notes.join('; ') || 'The source molecule could not be read confidently.' } };
  const issue = topologyIssue(topology);
  if (issue) return { ok: false, diagnostic: { code: 'invalid_topology', message: issue } };
  const validation = await validateMolfileGraph(molfile(topology));
  if (!validation.ok) return validation;
  if (topology.bonds.some((bond) => bond.stereo !== 'none') && !validation.graph.canonicalSmiles.includes('@')) {
    return { ok: false, diagnostic: { code: 'invalid_topology', message: 'The transcribed wedge/dash evidence did not produce a defined stereochemical graph; manual review is required.' } };
  }
  const observedRingSizes = topology.rings.map((ring) => ring.length).sort((first, second) => first - second);
  if (JSON.stringify(observedRingSizes) !== JSON.stringify(validation.graph.ringSizes)) {
    return { ok: false, diagnostic: { code: 'invalid_topology', message: 'Declared source ring vertices disagree with the parsed molecular ring basis; manual review is required.' } };
  }
  return validation;
}

export type ChemistryTopologyResult<T> = { value: T; applied: number; audits: MolecularTopologyAudit[]; diagnostics: ChemistryDiagnostic[]; sourceCounts?: ChemistrySourceScope[] };

/** Correct readable molecules independently while keeping unresolved tokens visible in their original slots. */
export async function applySourceTopologyAudit<T>(value: T, response: unknown, scopes: ChemistrySourceScope[]): Promise<ChemistryTopologyResult<T>> {
  const candidates = enumerateSmilesCandidates(value);
  const invalid = (code: ChemistryDiagnostic['code'], message: string): ChemistryTopologyResult<T> => ({
    value, applied: 0, diagnostics: [{ code, message }],
    audits: candidates.map((candidate) => ({ candidateId: candidate.id, fieldPath: candidate.fieldPath, status: 'unresolved', message })),
  });
  const parsed = ChemistryTopologyResponseSchema.safeParse(response);
  if (!parsed.success) return invalid('invalid_response', 'Independent atom/bond evidence did not match the required response schema.');
  if (parsed.data.molecules.length !== candidates.length || parsed.data.molecules.some((entry, index) => entry.id !== candidates[index]?.id)) return invalid('candidate_ledger_mismatch', 'Topology IDs must contain every existing molecule exactly once in its original order.');
  if (parsed.data.source_counts.length !== scopes.length || parsed.data.source_counts.some((entry, index) => entry.field_path !== scopes[index]?.fieldPath)) return invalid('candidate_ledger_mismatch', 'Source coverage must contain every owned field exactly once in its original order.');
  const diagnostics: ChemistryDiagnostic[] = [];
  const unresolvedFields = new Set<string>();
  for (const [index, source] of parsed.data.source_counts.entries()) {
    if (source.observed_molecule_count !== scopes[index]?.moleculeCount) {
      unresolvedFields.add(source.field_path);
      diagnostics.push({ code: 'source_coverage_mismatch', message: `${source.field_path}: the source contains ${String(source.observed_molecule_count)} drawn molecules but the transcription contains ${String(scopes[index]?.moleculeCount ?? 0)}; missing or merged structures need review.` });
    }
  }
  const patches = candidates.map((candidate) => ({ id: candidate.id, smiles: candidate.smiles }));
  const audits: MolecularTopologyAudit[] = [];
  for (const [index, topology] of parsed.data.molecules.entries()) {
    const candidate = candidates[index];
    const patch = patches[index];
    if (!candidate || !patch) continue;
    if (unresolvedFields.has(candidate.fieldPath)) {
      audits.push({ candidateId: candidate.id, fieldPath: candidate.fieldPath, status: 'unresolved', message: 'Molecular coverage in this field does not match the source; its candidates require review.' });
      continue;
    }
    const graph = await graphFromSourceTopology(topology);
    if (!graph.ok) {
      diagnostics.push({ ...graph.diagnostic, candidateId: candidate.id });
      audits.push({ candidateId: candidate.id, fieldPath: candidate.fieldPath, status: 'unresolved', message: graph.diagnostic.message });
      continue;
    }
    const existing = await validateSmilesGraph(candidate.smiles);
    const matches = existing.ok && existing.graph.graphFingerprint === graph.graph.graphFingerprint;
    patch.smiles = graph.graph.canonicalSmiles;
    audits.push({ candidateId: candidate.id, fieldPath: candidate.fieldPath, status: matches ? 'matched' : 'corrected', message: matches ? 'The primary SMILES and independently traced atom/bond graph agree.' : 'The primary SMILES was corrected from the independently traced source atom/bond graph.', canonicalSmiles: graph.graph.canonicalSmiles, graphFingerprint: graph.graph.graphFingerprint });
  }
  // Unreadable original tokens may be invalid. They remain byte-for-byte unchanged, while validated
  // source topologies can still repair the other independently owned slots.
  const replacements = new Map(patches.filter((patch) => audits.some((audit) => audit.candidateId === patch.id && audit.status !== 'unresolved')).map((patch) => [patch.id, patch.smiles]));
  const applied = candidates.filter((candidate) => replacements.has(candidate.id) && replacements.get(candidate.id) !== candidate.smiles).length;
  return { value: replaceOwnedSmilesTokens(value, replacements), applied, audits, diagnostics, sourceCounts: parsed.data.source_counts.map((entry) => ({ fieldPath: entry.field_path, moleculeCount: entry.observed_molecule_count })) };
}
