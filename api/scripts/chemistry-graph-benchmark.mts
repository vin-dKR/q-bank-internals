/** Offline exact-graph scoring for manually frozen, source-owned SMILES gold. */
import { z } from 'zod';
import { enumerateSmilesCandidates, validateSmilesGraph } from '../src/infrastructure/ai/chemistry-audit.js';
import { normalizePrintedQuestionLabel, questionNumberFromPrintedLabel } from '../src/modules/extraction/question-identity.js';

const MoleculeGoldSchema = z.object({
  name: z.string(),
  smiles: z.string(),
  acceptableRepresentations: z.array(z.string()).default([]),
});
export const ChemistryGraphGoldSchema = z.object({
  schemaVersion: z.literal(1),
  frozenAt: z.string(),
  provenance: z.string(),
  limitations: z.array(z.string()),
  sources: z.record(z.object({ sha256: z.string(), path: z.string() })),
  fields: z.array(z.object({
    id: z.string(),
    split: z.enum(['development', 'holdout']),
    documentId: z.string(),
    page: z.number().int().positive(),
    printedLabel: z.string(),
    field: z.string().regex(/^(?:stem|option-[A-Za-z0-9]+)$/u),
    molecules: z.array(MoleculeGoldSchema).min(1),
    notes: z.string().default(''),
  })),
});
export type ChemistryGraphGold = z.infer<typeof ChemistryGraphGoldSchema>;

const RowSchema = z.object({
  printedLabel: z.string().nullable().optional(),
  questionNumber: z.number().nullable().optional(),
  sourceRegion: z.object({ page: z.number().int() }),
  stem: z.string(),
  options: z.array(z.object({ label: z.string(), body: z.string() })),
  isQuestionImage: z.boolean().optional(),
  questionImage: z.string().nullable().optional(),
  isOptionImage: z.boolean().optional(),
  optionImages: z.array(z.string()).optional(),
});
const DraftSchema = z.object({
  printedLabel: z.string().nullable().optional(),
  questionNumber: z.number().nullable().optional(),
  sourcePage: z.number().int(),
  questionText: z.string(),
  options: z.array(z.string()),
});
export const ChemistryGraphResultSchema = z.array(z.object({
  documentId: z.string(), rows: z.array(RowSchema), drafts: z.array(DraftSchema).default([]),
}));
export type ChemistryGraphResults = z.infer<typeof ChemistryGraphResultSchema>;
const QuestionSnapshotSchema = z.object({ data: z.object({ questions: z.array(RowSchema.extend({ documentId: z.string() })) }) });

/** Accept either this benchmark's local materialization or a frozen stored-question snapshot. */
export function parseSavedChemistryGraphResults(value: unknown): ChemistryGraphResults {
  const finalized = ChemistryGraphResultSchema.safeParse(value);
  if (finalized.success) return finalized.data;
  const rows = QuestionSnapshotSchema.parse(value).data.questions;
  const documentIds = [...new Set(rows.map((row) => row.documentId))];
  return documentIds.map((documentId) => {
    const selected = rows.filter((row) => row.documentId === documentId);
    return {
      documentId, rows: selected,
      drafts: selected.map((row) => ({
        ...(row.printedLabel !== undefined ? { printedLabel: row.printedLabel } : {}),
        ...(row.questionNumber !== undefined ? { questionNumber: row.questionNumber } : {}),
        sourcePage: row.sourceRegion.page, questionText: row.stem,
        options: row.options.map((option) => `(${option.label}) ${option.body}`),
      })),
    };
  });
}

/** A caller-declared source alias changes only the document identity, never extracted content. */
export function aliasChemistryGraphResults(results: ChemistryGraphResults, aliases: ReadonlyMap<string, string>): ChemistryGraphResults {
  const mapped = results.map((result) => ({ ...result, documentId: aliases.get(result.documentId) ?? result.documentId }));
  if (new Set(mapped.map((result) => result.documentId)).size !== mapped.length) throw new Error('Document aliases would combine two different question sources.');
  for (const source of aliases.keys()) {
    if (!results.some((result) => result.documentId === source)) throw new Error('A declared source alias has no question records.');
  }
  return mapped;
}
type GoldField = ChemistryGraphGold['fields'][number];
type MoleculeComparison = {
  name: string; goldSmiles: string; acceptedCanonical: string[]; candidateSmiles: string | null;
  canonicalSmiles: string | null; parseValid: boolean; graphExact: boolean; goldRings: number[];
  candidateRings: number[] | null;
};
type FieldComparison = {
  id: string; split: GoldField['split']; documentId: string; page: number; printedLabel: string;
  field: string; questionFound: boolean; identityAmbiguous: boolean; sourceImageDisplayed: boolean;
  candidateSmiles: string[]; expectedMolecules: number; extraMolecules: number; graphExact: boolean;
  comparisons: MoleculeComparison[];
};
type GraphMetrics = {
  expectedMolecules: number; emittedMolecules: number; exactMolecules: number; parseValidMolecules: number;
  missingMolecules: number; extraMolecules: number; exactFields: number; totalFields: number;
  sourceImageFields: number; precisionPercent: number | null; recallPercent: number; coveragePercent: number;
  exactFieldPercent: number;
};
export type ChemistryGraphScore = {
  basis: string; goldFrozenAt: string; origin: string; graphEngine: string;
  goldHash: string; production: GraphMetrics; auditCandidates: GraphMetrics;
  development: GraphMetrics; holdout: GraphMetrics; comparisons: FieldComparison[];
  candidateComparisons: FieldComparison[]; limitations: string[];
};

function rowLabel(row: z.infer<typeof RowSchema> | z.infer<typeof DraftSchema>): string | null {
  return normalizePrintedQuestionLabel(row.printedLabel ?? (row.questionNumber === null || row.questionNumber === undefined ? null : String(row.questionNumber)));
}

function optionText(options: Array<{ label: string; body: string }> | string[], field: string): string {
  const wanted = field.slice('option-'.length).toUpperCase();
  const matches = options.filter((option) => typeof option === 'string'
    ? /^\s*\(([A-Za-z0-9]+)\)/u.exec(option)?.[1]?.toUpperCase() === wanted
    : option.label.toUpperCase() === wanted);
  if (matches.length !== 1) return '';
  const match = matches[0];
  return typeof match === 'string' ? match : match?.body ?? '';
}

async function compareMolecule(gold: z.infer<typeof MoleculeGoldSchema>, current: string | undefined): Promise<MoleculeComparison> {
  const references = await Promise.all([gold.smiles, ...gold.acceptableRepresentations].map(validateSmilesGraph));
  if (references.some((reference) => !reference.ok)) throw new Error(`Frozen gold contains an invalid molecular graph: ${gold.name}.`);
  const acceptedCanonical = references.flatMap((reference) => reference.ok ? [reference.graph.canonicalSmiles] : []);
  const candidate = current ? await validateSmilesGraph(current) : null;
  const first = references[0];
  return {
    name: gold.name, goldSmiles: gold.smiles, acceptedCanonical, candidateSmiles: current ?? null,
    canonicalSmiles: candidate?.ok ? candidate.graph.canonicalSmiles : null, parseValid: candidate?.ok === true,
    graphExact: candidate?.ok === true && acceptedCanonical.includes(candidate.graph.canonicalSmiles),
    goldRings: first?.ok ? first.graph.ringSizes : [], candidateRings: candidate?.ok ? candidate.graph.ringSizes : null,
  };
}

async function compareField(gold: GoldField, results: ChemistryGraphResults, useDraft: boolean): Promise<FieldComparison> {
  const result = results.find((entry) => entry.documentId === gold.documentId);
  const label = normalizePrintedQuestionLabel(gold.printedLabel);
  const pageRows = result?.rows.filter((row) => row.sourceRegion.page === gold.page) ?? [];
  const pageDrafts = result?.drafts.filter((draft) => draft.sourcePage === gold.page) ?? [];
  const exactRows = pageRows.filter((row) => rowLabel(row) === label);
  const exactDrafts = pageDrafts.filter((draft) => rowLabel(draft) === label);
  // Older saved rows omit printed labels. Numeric fallback is limited to this exact PDF page
  // and only unlabelled records; repeated physical ordinals remain ambiguous and earn no credit.
  const ordinal = questionNumberFromPrintedLabel(label);
  const rows = exactRows.length ? exactRows : pageRows.filter((row) => !row.printedLabel && ordinal !== null && row.questionNumber === ordinal);
  const drafts = exactDrafts.length ? exactDrafts : pageDrafts.filter((draft) => !draft.printedLabel && ordinal !== null && draft.questionNumber === ordinal);
  const matches = useDraft ? drafts : rows;
  const row = rows.length === 1 ? rows[0] : undefined;
  const draft = drafts.length === 1 ? drafts[0] : undefined;
  const fieldText = useDraft
    ? gold.field === 'stem' ? draft?.questionText ?? '' : optionText(draft?.options ?? [], gold.field)
    : gold.field === 'stem' ? row?.stem ?? '' : optionText(row?.options ?? [], gold.field);
  const smiles = enumerateSmilesCandidates({ stem: fieldText }).map((candidate) => candidate.smiles);
  const comparisons = await Promise.all(gold.molecules.map((molecule, index) => compareMolecule(molecule, smiles[index])));
  const optionIndex = row?.options.findIndex((option) => option.label.toUpperCase() === gold.field.slice('option-'.length).toUpperCase()) ?? -1;
  const sourceImageDisplayed = gold.field === 'stem'
    ? row?.isQuestionImage === true && Boolean(row.questionImage)
    : row?.isOptionImage === true && optionIndex >= 0 && Boolean(row.optionImages?.[optionIndex]);
  return {
    id: gold.id, split: gold.split, documentId: gold.documentId, page: gold.page, printedLabel: gold.printedLabel,
    field: gold.field, questionFound: matches.length === 1, identityAmbiguous: matches.length > 1,
    sourceImageDisplayed, candidateSmiles: smiles, expectedMolecules: gold.molecules.length,
    extraMolecules: Math.max(0, smiles.length - gold.molecules.length),
    graphExact: matches.length === 1 && smiles.length === gold.molecules.length && comparisons.every((comparison) => comparison.graphExact), comparisons,
  };
}

function metrics(fields: FieldComparison[]): GraphMetrics {
  const expectedMolecules = fields.reduce((sum, field) => sum + field.expectedMolecules, 0);
  const emittedMolecules = fields.reduce((sum, field) => sum + field.candidateSmiles.length, 0);
  const exactMolecules = fields.reduce((sum, field) => sum + field.comparisons.filter((comparison) => comparison.graphExact).length, 0);
  const parseValidMolecules = fields.reduce((sum, field) => sum + field.comparisons.filter((comparison) => comparison.parseValid).length, 0);
  const missingMolecules = fields.reduce((sum, field) => sum + Math.max(0, field.expectedMolecules - field.candidateSmiles.length), 0);
  const extraMolecules = fields.reduce((sum, field) => sum + field.extraMolecules, 0);
  const exactFields = fields.filter((field) => field.graphExact).length;
  const percent = (value: number): number => expectedMolecules ? 100 * value / expectedMolecules : 0;
  return {
    expectedMolecules, emittedMolecules, exactMolecules, parseValidMolecules, missingMolecules, extraMolecules,
    exactFields, totalFields: fields.length, sourceImageFields: fields.filter((field) => field.sourceImageDisplayed).length,
    precisionPercent: emittedMolecules ? 100 * exactMolecules / emittedMolecules : null,
    recallPercent: percent(exactMolecules), coveragePercent: percent(expectedMolecules - missingMolecules),
    exactFieldPercent: fields.length ? 100 * exactFields / fields.length : 0,
  };
}

/** Ownership and within-field ordering are scored before graph equivalence; crops earn zero credit. */
export async function scoreChemistryGraphs(
  gold: ChemistryGraphGold, results: ChemistryGraphResults, provenance: { origin: string; goldHash: string },
): Promise<ChemistryGraphScore> {
  const comparisons = await Promise.all(gold.fields.map((field) => compareField(field, results, false)));
  const candidateComparisons = await Promise.all(gold.fields.map((field) => compareField(field, results, true)));
  const reference = await validateSmilesGraph(gold.fields[0]?.molecules[0]?.smiles ?? 'C');
  return {
    basis: 'Ordered, source-owned RDKit canonical isomeric SMILES equality. Missing graphs and image substitutions earn no exact-graph credit.',
    goldFrozenAt: gold.frozenAt, origin: provenance.origin, goldHash: provenance.goldHash,
    graphEngine: reference.ok ? reference.graph.engineVersion : 'unavailable',
    production: metrics(comparisons), auditCandidates: metrics(candidateComparisons),
    development: metrics(comparisons.filter((field) => field.split === 'development')),
    holdout: metrics(comparisons.filter((field) => field.split === 'holdout')),
    comparisons, candidateComparisons, limitations: gold.limitations,
  };
}
