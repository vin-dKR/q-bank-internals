import { createHash } from 'node:crypto';
import initRDKit, { type MainModule } from '@rdkit/rdkit';
import { z } from 'zod';

const MOLECULAR_TEXT_FIELDS = new Set([
  'stem', 'question_text', 'questionText', 'passage', 'answer', 'explanation', 'body', 'text',
]);
const MAX_SMILES_LENGTH = 4096;
const SMILES_TAG_PATTERN = /<smiles>([\s\S]*?)<\/smiles>/g;

export type SmilesCandidate = {
  id: string;
  fieldPath: string;
  index: number;
  smiles: string;
  /** Source text supplies option/reaction context without giving the audit ownership of it. */
  fieldText: string;
};

export type ChemistryDiagnostic = {
  code: 'invalid_response' | 'candidate_ledger_mismatch' | 'invalid_smiles' |
    'ambiguous_structure' | 'engine_unavailable' | 'graph_diagnostics_unavailable' |
    'invalid_topology' | 'source_coverage_mismatch';
  message: string;
  candidateId?: string;
};

export type MolecularGraph = {
  canonicalSmiles: string;
  graphFingerprint: string;
  atomCount: number;
  bondCount: number;
  componentCount: number;
  formalCharge: number;
  /** RDKit's symmetrized smallest-ring basis; this is not a list of every possible cycle. */
  ringSizes: number[];
  aromaticAtomCount: number;
  engineVersion: string;
};

export type SmilesValidation =
  | { ok: true; graph: MolecularGraph }
  | { ok: false; diagnostic: ChemistryDiagnostic };

export type SmilesGraphValidator = (smiles: string) => Promise<SmilesValidation>;

export const ChemistryAuditResponseSchema = z.object({
  patches: z.array(z.object({
    id: z.string().min(1),
    smiles: z.string().min(1).max(MAX_SMILES_LENGTH).regex(/^[^\s<>]+$/),
  }).strict()),
}).strict();

type PathPart = string | number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fieldPath(path: PathPart[]): string {
  return '/' + path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

function visitMolecularText(
  value: unknown,
  visit: (text: string, path: string) => void,
  path: PathPart[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((child: unknown, index) => {
      if (typeof child === 'string' && path.at(-1) === 'options') {
        visit(child, fieldPath([...path, index]));
      } else {
        visitMolecularText(child, visit, [...path, index]);
      }
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (typeof child === 'string' && (MOLECULAR_TEXT_FIELDS.has(key) || path.at(-1) === 'answers' || path.at(-1) === 'solutions')) {
      visit(child, fieldPath(childPath));
    } else if (typeof child !== 'string') {
      visitMolecularText(child, visit, childPath);
    }
  }
}

/** Enumerate in source field/order, including repeated molecules as separately owned candidates. */
export function enumerateSmilesCandidates(value: unknown): SmilesCandidate[] {
  const candidates: SmilesCandidate[] = [];
  visitMolecularText(value, (text, path) => {
    for (const [index, match] of Array.from(text.matchAll(SMILES_TAG_PATTERN)).entries()) {
      candidates.push({
        id: `${path}/smiles/${String(index)}`,
        fieldPath: path,
        index,
        smiles: match[1] ?? '',
        fieldText: text,
      });
    }
  });
  return candidates;
}

export function enumerateMolecularFields(value: unknown): Array<{ fieldPath: string; fieldText: string; moleculeCount: number }> {
  const fields: Array<{ fieldPath: string; fieldText: string; moleculeCount: number }> = [];
  visitMolecularText(value, (text, path) => {
    fields.push({ fieldPath: path, fieldText: text, moleculeCount: Array.from(text.matchAll(SMILES_TAG_PATTERN)).length });
  });
  return fields;
}

const RdkitGraphSchema = z.object({
  molecules: z.array(z.object({
    atoms: z.array(z.object({
      z: z.number().int().optional(),
      chg: z.number().int().optional(),
    }).passthrough()),
    bonds: z.array(z.object({ atoms: z.tuple([z.number().int(), z.number().int()]) }).passthrough()),
    extensions: z.array(z.object({
      name: z.string(),
      aromaticAtoms: z.array(z.number().int()).optional(),
      atomRings: z.array(z.array(z.number().int())).optional(),
    }).passthrough()).optional(),
  }).passthrough()).length(1),
}).passthrough();

let rdkitPromise: Promise<MainModule> | undefined;

function loadRdkit(): Promise<MainModule> {
  // The package exports a CommonJS factory at runtime but its generated declaration uses an ES
  // default export. NodeNext sees a namespace; this boundary cast describes the actual SDK export.
  const initialize: () => Promise<MainModule> = initRDKit as unknown as () => Promise<MainModule>;
  rdkitPromise ??= initialize();
  return rdkitPromise;
}

function componentCount(atomCount: number, bonds: Array<{ atoms: [number, number] }>): number {
  const adjacency = Array.from({ length: atomCount }, () => new Set<number>());
  for (const { atoms: [first, second] } of bonds) {
    adjacency[first]?.add(second);
    adjacency[second]?.add(first);
  }
  const visited = new Set<number>();
  let count = 0;
  for (let atom = 0; atom < atomCount; atom += 1) {
    if (visited.has(atom)) continue;
    count += 1;
    const pending = [atom];
    for (const current of pending) {
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adjacency[current] ?? []) {
        if (!visited.has(neighbor)) pending.push(neighbor);
      }
    }
  }
  return count;
}

function invalidSmiles(message: string): SmilesValidation {
  return { ok: false, diagnostic: { code: 'invalid_smiles', message } };
}

/** Parse and sanitize with RDKit; validity establishes a graph, never visual/source agreement. */
export async function validateSmilesGraph(smiles: string): Promise<SmilesValidation> {
  if (!smiles || smiles.length > MAX_SMILES_LENGTH || /[\s<>]/.test(smiles)) {
    return invalidSmiles('Expected one raw SMILES token, without markup, names, whitespace, or reaction arrows.');
  }
  return validateMolecularInput(smiles);
}

/** The independently transcribed topology adapter emits V3000, never executable input. */
export async function validateMolfileGraph(molfile: string): Promise<SmilesValidation> {
  if (molfile.length > 262144 || !molfile.includes('M  V30 BEGIN CTAB') || !molfile.endsWith('M  END\n')) {
    return { ok: false, diagnostic: { code: 'invalid_topology', message: 'Expected a bounded complete V3000 molecular graph.' } };
  }
  return validateMolecularInput(molfile);
}

async function validateMolecularInput(input: string): Promise<SmilesValidation> {
  let engine: MainModule;
  try {
    engine = await loadRdkit();
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: 'engine_unavailable',
        message: `RDKit could not initialize: ${error instanceof Error ? error.message : 'unknown initialization error'}`,
      },
    };
  }
  let molecule: ReturnType<MainModule['get_mol']>;
  try {
    // Ordinary explicit H atoms in a Molfile and implicit H in SMILES denote the same molecule.
    // Normalizing them retains isotope-labeled hydrogen and stereochemical information.
    molecule = engine.get_mol(input, JSON.stringify({ removeHs: true }));
  } catch (error) {
    return invalidSmiles(`RDKit rejected the molecular input: ${error instanceof Error ? error.message : 'parser error'}`);
  }
  if (!molecule) return invalidSmiles('RDKit rejected the SMILES syntax or molecular valence.');
  try {
    if (!molecule.is_valid()) return invalidSmiles('RDKit could not sanitize the molecular graph.');
    const parsed = RdkitGraphSchema.safeParse(JSON.parse(molecule.get_json()));
    const graph = parsed.success ? parsed.data.molecules[0] : undefined;
    if (!graph || graph.atoms.length === 0) {
      return {
        ok: false,
        diagnostic: { code: 'graph_diagnostics_unavailable', message: 'RDKit returned no readable graph diagnostics.' },
      };
    }
    if (graph.atoms.some((atom) => atom.z === 0)) {
      return {
        ok: false,
        diagnostic: { code: 'ambiguous_structure', message: 'The graph contains unspecified atoms; preserve the source image for review.' },
      };
    }
    if (graph.extensions?.some((extension) => extension.name === 'rdkitQueries')) {
      return { ok: false, diagnostic: { code: 'ambiguous_structure', message: 'The input describes a substructure query rather than a complete molecular graph.' } };
    }
    const representation = graph.extensions?.find((extension) => extension.name === 'rdkitRepresentation');
    const canonicalSmiles = molecule.get_smiles();
    return {
      ok: true,
      graph: {
        canonicalSmiles,
        graphFingerprint: `sha256:${createHash('sha256').update(canonicalSmiles).digest('hex')}`,
        atomCount: graph.atoms.length,
        bondCount: graph.bonds.length,
        componentCount: componentCount(graph.atoms.length, graph.bonds),
        formalCharge: graph.atoms.reduce((charge, atom) => charge + (atom.chg ?? 0), 0),
        ringSizes: (representation?.atomRings ?? []).map((ring) => ring.length).sort((a, b) => a - b),
        aromaticAtomCount: representation?.aromaticAtoms?.length ?? 0,
        engineVersion: engine.version(),
      },
    };
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: 'graph_diagnostics_unavailable',
        message: `RDKit graph inspection failed: ${error instanceof Error ? error.message : 'unknown graph error'}`,
      },
    };
  } finally {
    molecule.delete();
  }
}

export type CandidateGraphAudit = {
  candidate: SmilesCandidate;
  validation: SmilesValidation;
};

export async function auditSmilesCandidates(
  value: unknown,
  validator: SmilesGraphValidator = validateSmilesGraph,
): Promise<CandidateGraphAudit[]> {
  return Promise.all(enumerateSmilesCandidates(value).map(async (candidate) => ({
    candidate,
    validation: await validator(candidate.smiles),
  })));
}

function replaceMolecularStrings(
  value: unknown,
  patches: Map<string, string>,
  path: PathPart[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((child: unknown, index) => replaceMolecularStrings(child, patches, [...path, index]));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key, replaceMolecularStrings(child, patches, [...path, key]),
    ]));
  }
  if (typeof value !== 'string') return value;
  let index = 0;
  return value.replace(SMILES_TAG_PATTERN, (whole: string) => {
    const replacement = patches.get(`${fieldPath(path)}/smiles/${String(index)}`);
    index += 1;
    return replacement === undefined ? whole : `<smiles>${replacement}</smiles>`;
  });
}

/** Callers must first validate the complete ownership ledger and each changed molecular graph. */
export function replaceOwnedSmilesTokens<T>(value: T, replacements: Map<string, string>): T {
  // The recursive rebuild changes only existing SMILES strings; object keys and all other values
  // preserve the original runtime shape, so the input generic remains valid.
  return replaceMolecularStrings(value, replacements) as T;
}

export type ChemistryPatchResult<T> = {
  ok: boolean;
  value: T;
  applied: number;
  diagnostics: ChemistryDiagnostic[];
};

/**
 * Accept a complete ordered molecular ledger and rebuild only its existing SMILES values. The AI
 * never returns candidate JSON, so it cannot delete questions, change labels, or rewrite prose.
 * A failed ledger or graph rejects the entire correction, preserving the first extraction.
 */
export async function applySmilesPatches<T>(
  value: T,
  response: unknown,
  validator: SmilesGraphValidator = validateSmilesGraph,
): Promise<ChemistryPatchResult<T>> {
  const parsed = ChemistryAuditResponseSchema.safeParse(response);
  if (!parsed.success) {
    return {
      ok: false, value, applied: 0,
      diagnostics: [{ code: 'invalid_response', message: 'Expected only {patches:[{id,smiles}]} with no extra fields.' }],
    };
  }
  const candidates = enumerateSmilesCandidates(value);
  if (parsed.data.patches.length !== candidates.length ||
    parsed.data.patches.some((patch, index) => patch.id !== candidates[index]?.id)) {
    return {
      ok: false, value, applied: 0,
      diagnostics: [{ code: 'candidate_ledger_mismatch', message: 'Patch IDs must contain every existing molecule exactly once, in its original order.' }],
    };
  }
  const diagnostics: ChemistryDiagnostic[] = [];
  const replacements = new Map<string, string>();
  let applied = 0;
  for (const [index, patch] of parsed.data.patches.entries()) {
    const validation = await validator(patch.smiles);
    if (!validation.ok) {
      diagnostics.push({ ...validation.diagnostic, candidateId: patch.id });
    } else {
      replacements.set(patch.id, patch.smiles);
      if (patch.smiles !== candidates[index]?.smiles) applied += 1;
    }
  }
  if (diagnostics.length > 0) return { ok: false, value, applied: 0, diagnostics };
  // Reconstruction preserves the input shape and every non-SMILES value; only strings are edited.
  const patched = replaceOwnedSmilesTokens(value, replacements);
  return { ok: true, value: patched, applied, diagnostics: [] };
}
