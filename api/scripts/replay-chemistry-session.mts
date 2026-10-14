/** Local-only replay of previously recorded recognition; no model client, database, or remote image store. */
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ChemistryExtractionSchema, DocumentSchema, ImageCropSchema, MatchDataSchema } from '@ingest/contracts';
import { PdfToImgRasterizer } from '../src/infrastructure/pdf/pdf-to-img.rasterizer.js';
import { SharpImageCropper } from '../src/infrastructure/pdf/sharp-image-cropper.js';
import { parseChemistryInventory } from '../src/infrastructure/ai/chemistry-page-inventory.js';
import { enumerateSmilesCandidates, validateSmilesGraph } from '../src/infrastructure/ai/chemistry-audit.js';
import { ExtractionVisualsService } from '../src/modules/extraction/extraction-visuals.service.js';
import { nativeChoiceSheet } from '../src/modules/extraction/native-choice-key.js';
import { normalizePrintedQuestionLabel } from '../src/modules/extraction/question-identity.js';
import { materializePassages } from '../src/modules/extraction/group-comprehension.js';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import { toNewQuestion } from '../src/modules/extraction/extraction.worker.js';
import type { AnswerSheet, ExtractedQuestion, PageImage } from '../src/modules/extraction/index.js';
import type { NewQuestion } from '../src/modules/questions/index.js';
import { AppError } from '../src/shared/errors/app-error.js';

const NITROGEN_ID = '6ac130a7488c2ce717aa9661';
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UsageSchema = z.object({ model: z.string(), promptTokens: z.number(), completionTokens: z.number(), totalTokens: z.number(), callCount: z.number() });
const AnswerSheetSchema = z.object({ sectionName: z.string().nullable(), entries: z.record(z.object({ answer: z.string().nullable(), explanation: z.string().nullable(), answerSource: z.enum(['answer_key', 'solution', 'unknown']).optional(), answerConflict: z.boolean().optional() })) }).transform((sheet): AnswerSheet => ({
  sectionName: sheet.sectionName,
  entries: Object.fromEntries(Object.entries(sheet.entries).map(([label, entry]) => {
    const { answerSource, answerConflict, ...content } = entry;
    return [label, { ...content, ...(answerSource !== undefined ? { answerSource } : {}), ...(answerConflict !== undefined ? { answerConflict } : {}) }];
  })),
}));
const DraftSchema = z.object({
  questionNumber: z.number().int().nullable(), printedLabel: z.string().nullable().optional(), questionText: z.string(), options: z.array(z.string()),
  answer: z.string().nullable(), explanation: z.string().nullable(), sectionName: z.string().nullable(), questionType: z.string().nullable(),
  level: z.string().nullable(), difficultyConfidence: z.number().nullable(), sourcePage: z.number().int(), pyqExam: z.string().nullable(), pyqYear: z.string().nullable(),
  match: MatchDataSchema.nullable(), passage: z.string().nullable(), passageId: z.string().nullable(), groupOrder: z.number().int().nullable(),
  chemistry: ChemistryExtractionSchema.nullable().optional(), sourceBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), imageCrops: z.array(ImageCropSchema).optional(),
}).transform((draft): ExtractedQuestion => {
  const { printedLabel, chemistry, sourceBbox, imageCrops, ...content } = draft;
  return { ...content, ...(printedLabel !== undefined ? { printedLabel } : {}), ...(chemistry !== undefined ? { chemistry } : {}), ...(sourceBbox !== undefined ? { sourceBbox } : {}), ...(imageCrops !== undefined ? { imageCrops } : {}) };
});
const ReceiptSchema = z.object({
  signature: z.string(), documentId: z.string(), pageNumber: z.number().int(), phase: z.enum(['question', 'answer']), status: z.enum(['complete', 'recognized', 'failed']),
  startedAt: z.string(), finishedAt: z.string(), durationMs: z.number(), usage: UsageSchema.nullable(),
  extraction: z.object({ questions: z.array(DraftSchema), usage: UsageSchema, sheets: z.array(AnswerSheetSchema).optional() }).optional(),
  error: z.object({ name: z.string(), message: z.string() }).optional(),
});
const ManifestSchema = z.object({ fingerprint: z.string(), model: z.string(), codeHash: z.string(), pdfHashes: z.record(z.string()), sessionId: z.string().nullable() });
const DocumentsSchema = z.object({ data: z.object({ items: z.array(DocumentSchema) }) });
const BaselineSchema = z.object({
  page9MoleculeGold: z.array(z.object({ sourceLabel: z.string(), field: z.string(), goldSmiles: z.string(), graphExact: z.boolean() })),
  page9Answers: z.array(z.object({ sourceLabel: z.string(), goldAnswer: z.string(), exact: z.boolean() })),
});
type Receipt = z.infer<typeof ReceiptSchema>;
type Options = { input: string; sources: string; output: string; modelReplies?: string };
type SafeError = { name: string; message: string };
type ReplayedPage = { original: Receipt; page?: PageImage; drafts: ExtractedQuestion[]; error?: SafeError; inventoryValidated: boolean };

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function save(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

function safeError(error: unknown): SafeError {
  return error instanceof AppError ? { name: error.code, message: error.message } : { name: error instanceof Error ? error.name : 'UnknownError', message: 'Local replay validation or file processing failed.' };
}

function options(): Options | null {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: node --conditions=development --import tsx scripts/replay-chemistry-session.mts --input /prior/run --sources /private/tmp/chemistry-session-audit --output /local/replay [--model-replies /prior/model-replies]\nNo OpenAI calls, source uploads, or database writes are made. Prior failed pages remain unresolved.\n');
    return null;
  }
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key || !['--input', '--sources', '--output', '--model-replies'].includes(key) || !value || value.startsWith('--')) throw new Error('Supply the replay input, source, and output paths as named arguments.');
    values.set(key, path.resolve(value));
  }
  const input = values.get('--input');
  const sources = values.get('--sources');
  const output = values.get('--output');
  const modelReplies = values.get('--model-replies');
  if (!input || !sources || !output || input === output) throw new Error('Replay needs distinct input/output folders and a local source folder.');
  return { input, sources, output, ...(modelReplies ? { modelReplies } : {}) };
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function codeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? codeFiles(file) : entry.isFile() && /\.(?:ts|mts)$/u.test(file) ? [file] : [];
  }))).flat();
}

async function codeProvenance(): Promise<{ hash: string; files: Record<string, string> }> {
  const files: Record<string, string> = {};
  for (const file of [...await codeFiles(path.join(API_ROOT, 'src')), ...await codeFiles(path.join(API_ROOT, 'contracts/src')), fileURLToPath(import.meta.url), path.join(API_ROOT, 'package-lock.json')].sort()) files[path.relative(API_ROOT, file)] = sha256(await readFile(file));
  return { hash: sha256(JSON.stringify(files)), files };
}

async function scoreGraph(baseline: z.infer<typeof BaselineSchema>, drafts: ExtractedQuestion[]): Promise<unknown> {
  const comparisons = await Promise.all(baseline.page9MoleculeGold.map(async (gold) => {
    const draft = drafts.find((candidate) => candidate.sourcePage === 9 && normalizePrintedQuestionLabel(candidate.printedLabel) === normalizePrintedQuestionLabel(gold.sourceLabel));
    const label = gold.field.startsWith('option-') ? gold.field.slice(7) : null;
    const text = label === null ? draft?.questionText ?? '' : draft?.options.find((option) => /^\s*\(([A-Za-z0-9]+)\)/u.exec(option)?.[1]?.toUpperCase() === label.toUpperCase()) ?? '';
    const smiles = enumerateSmilesCandidates({ stem: text }).map((candidate) => candidate.smiles);
    const expected = await validateSmilesGraph(gold.goldSmiles);
    const candidate = smiles[0] ? await validateSmilesGraph(smiles[0]) : null;
    const exact = smiles.length === 1 && expected.ok && candidate?.ok === true && expected.graph.canonicalSmiles === candidate.graph.canonicalSmiles;
    return { ...gold, candidateSmiles: smiles, graphExact: exact, parseValid: candidate?.ok === true, candidateRings: candidate?.ok ? candidate.graph.ringSizes : null, goldRings: expected.ok ? expected.graph.ringSizes : null };
  }));
  const currentExact = comparisons.filter((comparison) => comparison.graphExact).length;
  const baselineExact = baseline.page9MoleculeGold.filter((comparison) => comparison.graphExact).length;
  return { origin: 'reused_recognition', scope: 'Previously recorded nitrogen page9 candidate graphs; current local postprocessing introduces no new model recognition.', total: comparisons.length, baselineExact, currentExact, baselinePercent: 100 * baselineExact / comparisons.length, currentPercent: 100 * currentExact / comparisons.length, improvementPercentagePoints: 100 * (currentExact - baselineExact) / comparisons.length, comparisons };
}

async function main(): Promise<void> {
  const args = options();
  if (!args) return;
  const startedAt = new Date().toISOString();
  await mkdir(args.output, { recursive: true });
  const manifest = ManifestSchema.parse(await json(path.join(args.input, 'run-manifest.json')));
  const original = z.array(ReceiptSchema).parse(await json(path.join(args.input, 'page-receipts.json')));
  const documents = DocumentsSchema.parse(await json(path.join(args.sources, 'documents.json'))).data.items;
  const baseline = BaselineSchema.parse(await json(path.join(args.sources, 'baseline-scorecard.json')));
  const sourceHashes: Record<string, { expected: string; actual: string; bytes: number; path: string }> = {};
  const pdfs = new Map<string, Buffer>();
  for (const [id, expected] of Object.entries(manifest.pdfHashes)) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(id)) throw new Error('Invalid source PDF identity.');
    const file = path.join(args.sources, `${id}.pdf`);
    const bytes = await readFile(file);
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error('The source PDF bytes differ from the prior recognition manifest.');
    sourceHashes[id] = { expected, actual, bytes: bytes.length, path: file };
    pdfs.set(id, bytes);
  }
  const defaultReplies = path.join(args.input, 'model-replies');
  const modelReplies = args.modelReplies ?? (await exists(defaultReplies) ? defaultReplies : path.join(args.input, '..', 'model-replies'));
  const currentCode = await codeProvenance();
  const rasterizer = new PdfToImgRasterizer(3);
  const cropRoot = path.join(args.output, 'crops');
  const visuals = new ExtractionVisualsService({ upload: async (name, bytes) => {
    const file = path.resolve(cropRoot, name);
    if (!file.startsWith(cropRoot + path.sep)) throw new Error('Invalid replay crop destination.');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return file;
  } }, new SharpImageCropper());
  const replayed: ReplayedPage[] = [];
  const replayReceipts: unknown[] = [];
  for (const receipt of original.filter((entry) => entry.phase === 'question')) {
    if (receipt.status !== 'complete' || !receipt.extraction) {
      replayed.push({ original: receipt, drafts: [], inventoryValidated: false });
      replayReceipts.push({ documentId: receipt.documentId, pageNumber: receipt.pageNumber, status: 'unresolved_prior_failure', recognition: { fingerprint: receipt.signature, model: receipt.usage?.model ?? manifest.model, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, status: receipt.status, error: receipt.error ?? null }, newUsage: { callCount: 0, totalTokens: 0 } });
      continue;
    }
    const start = Date.now();
    try {
      const source = pdfs.get(receipt.documentId);
      if (!source) throw new Error('A replayed page has no verified source PDF.');
      const page = await rasterizer.rasterizePage(source, receipt.pageNumber);
      await mkdir(path.join(args.output, 'pages'), { recursive: true });
      await writeFile(path.join(args.output, 'pages', `${receipt.documentId}-${String(receipt.pageNumber)}.png`), page.png);
      const replyPath = path.join(modelReplies, `question-${receipt.documentId}-${String(receipt.pageNumber)}-${receipt.signature}-call-1.json`);
      const raw = z.object({ phase: z.literal('inventory'), content: z.string() }).parse(await json(replyPath));
      const inventory = parseChemistryInventory(raw.content, page.layout);
      const currentLabels = inventory.question_regions.map((region) => normalizePrintedQuestionLabel(region.printed_label));
      const priorLabels = receipt.extraction.questions.map((question) => normalizePrintedQuestionLabel(question.printedLabel));
      if (JSON.stringify(currentLabels) !== JSON.stringify(priorLabels)) throw new Error('Current native ownership validation differs from the recorded recognition identities.');
      await save(path.join(args.output, 'inventories', `${receipt.documentId}-${String(receipt.pageNumber)}.json`), { originalReply: replyPath, originalReplySha256: sha256(await readFile(replyPath)), currentNativeValidation: inventory, nativeLayout: page.layout, cropGeometryPolicy: 'Preserve previously reviewed extraction crop rectangles; native inventory validation confirms current question ownership independently.' });
      const preserved = await visuals.preserve(receipt.documentId, page, receipt.extraction.questions);
      replayed.push({ original: receipt, page, drafts: preserved, inventoryValidated: true });
      replayReceipts.push({ documentId: receipt.documentId, pageNumber: receipt.pageNumber, status: 'complete', replayDurationMs: Date.now() - start, recognition: { fingerprint: receipt.signature, model: receipt.extraction.usage.model, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, originalCodeHash: receipt.signature === manifest.fingerprint ? manifest.codeHash : null, extractionSha256: sha256(JSON.stringify(receipt.extraction)), reused: true }, inventoryValidated: true, priorCropGeometryPreserved: true, newUsage: { callCount: 0, totalTokens: 0 }, sourcePdfSha256: sourceHashes[receipt.documentId]?.actual });
    } catch (error) {
      const failure = safeError(error);
      replayed.push({ original: receipt, drafts: [], inventoryValidated: false, error: failure });
      replayReceipts.push({ documentId: receipt.documentId, pageNumber: receipt.pageNumber, status: 'failed_local_validation', error: failure, recognitionFingerprint: receipt.signature, newUsage: { callCount: 0, totalTokens: 0 } });
    }
  }
  const nitrogen = documents.find((document) => document.id === NITROGEN_ID);
  if (!nitrogen) throw new Error('The verified source snapshot has no nitrogen question document.');
  const answerSource = documents.find((document) => document.kind === 'answer' && document.uploadGroupId === nitrogen.uploadGroupId);
  if (!answerSource) throw new Error('The source snapshot has no nitrogen answer companion.');
  const nitrogenDrafts = replayed.filter((entry) => entry.original.documentId === NITROGEN_ID).flatMap((entry) => entry.drafts);
  const bindings = nitrogen.topics.flatMap((topic) => topic.types.flatMap((block) => block.pageRange.from <= 9 && block.pageRange.to >= 9 && block.answerPageRange?.from === 5 && block.answerPageRange.to === 5 ? [{ topic, block }] : []));
  const binding = bindings[0];
  if (bindings.length !== 1 || !binding || binding.block.questionType !== 'single_correct') throw new Error('The source snapshot does not uniquely bind the pilot questions to single-correct answer page5.');
  const answerBytes = pdfs.get(answerSource.id);
  if (!answerBytes) throw new Error('The pilot answer PDF hash was not verified.');
  const answerPage = await rasterizer.rasterizePage(answerBytes, 5);
  const expectedLabels = nitrogenDrafts.flatMap((draft) => draft.printedLabel ? [draft.printedLabel] : []);
  const key = nativeChoiceSheet(answerPage.nativeChoiceKeys, expectedLabels, binding.topic.name);
  const answerProvenance = { source: 'current_local_native_pdf', sourceDocumentId: answerSource.id, sourcePage: 5, sourcePdfSha256: sourceHashes[answerSource.id]?.actual, scopeKey: binding.topic.name, questionType: binding.block.questionType, expectedPrintedLabels: expectedLabels, nativeChoiceKeys: answerPage.nativeChoiceKeys, scopedSheet: key, eligible: key !== null, newUsage: { callCount: 0, totalTokens: 0 }, noVisionFallback: true };
  await save(path.join(args.output, 'answer-source-provenance.json'), answerProvenance);
  const finalized: Array<{ documentId: string; drafts: ExtractedQuestion[]; rows: NewQuestion[]; passages: unknown[]; errors: SafeError[] }> = [];
  for (const documentId of [...new Set(original.filter((receipt) => receipt.phase === 'question').map((receipt) => receipt.documentId))]) {
    const document = documents.find((candidate) => candidate.id === documentId);
    if (!document) throw new Error('A recognition receipt has no source document snapshot.');
    const pages = replayed.filter((entry) => entry.original.documentId === documentId);
    const drafts = pages.flatMap((entry) => entry.drafts);
    const priorSheets = pages.filter((entry) => entry.inventoryValidated).flatMap((entry) => entry.original.extraction?.sheets ?? []);
    const answered = mergeAnswers(drafts, [...priorSheets, ...(documentId === NITROGEN_ID && key ? [key] : [])], document.topics);
    const grouped = materializePassages(answered, document.id);
    const rows: NewQuestion[] = [];
    const errors: SafeError[] = pages.flatMap((entry) => entry.error ? [entry.error] : []);
    for (const draft of grouped.drafts) {
      const owner = pages.find((page) => page.original.pageNumber === draft.sourcePage)?.original;
      try { rows.push(toNewQuestion(document, draft, { model: owner?.extraction?.usage.model ?? manifest.model, at: owner?.startedAt ?? startedAt })); }
      catch (error) { errors.push(safeError(error)); }
    }
    finalized.push({ documentId, drafts: answered, rows, passages: grouped.passages, errors });
  }
  const nitrogenRows = finalized.find((result) => result.documentId === NITROGEN_ID)?.rows ?? [];
  const answers = baseline.page9Answers.map((reference) => {
    const row = nitrogenRows.find((candidate) => normalizePrintedQuestionLabel(candidate.printedLabel) === normalizePrintedQuestionLabel(reference.sourceLabel));
    return { ...reference, currentAnswer: row?.answer ?? null, currentExact: row?.answer.trim().toUpperCase() === reference.goldAnswer.trim().toUpperCase() };
  });
  const allDrafts = finalized.flatMap((result) => result.drafts);
  const candidates = enumerateSmilesCandidates(allDrafts);
  const validation = await Promise.all(candidates.map((candidate) => validateSmilesGraph(candidate.smiles)));
  const graphPilot = await scoreGraph(baseline, nitrogenDrafts);
  const baselineAnswerExact = answers.filter((answer) => answer.exact).length;
  const currentAnswerExact = answers.filter((answer) => answer.currentExact).length;
  const finishedAt = new Date().toISOString();
  const unresolved = replayed.filter((page) => page.original.status !== 'complete').map((page) => ({ documentId: page.original.documentId, pageNumber: page.original.pageNumber, originalError: page.original.error ?? null }));
  const summary = { mode: 'local_only_replay', startedAt, finishedAt, recognitionReused: true, recognitionFingerprints: [...new Set(original.map((receipt) => receipt.signature))], currentPostprocessingCodeHash: currentCode.hash, newUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 }, sourceHashesVerified: true, completedQuestionPages: replayed.filter((page) => page.inventoryValidated && !page.error).length, recordedQuestionPages: original.filter((page) => page.phase === 'question').length, materializedQuestions: finalized.reduce((sum, document) => sum + document.rows.length, 0), unresolvedPriorPages: unresolved, localErrors: finalized.flatMap((document) => document.errors), sourcePreservation: { preservedVisuals: allDrafts.flatMap((draft) => draft.chemistry?.visuals ?? []).filter((visual) => visual.cropUrl).length, ownershipAndCompletenessRequireReview: true }, candidateSmiles: { total: candidates.length, parseValid: validation.filter((result) => result.ok).length, graphAccuracyClaim: false }, pilot: { graph: graphPilot, answers: { origin: 'current_local_native_key_reconciliation', total: answers.length, baselineExact: baselineAnswerExact, currentExact: currentAnswerExact, improvementPercentagePoints: 100 * (currentAnswerExact - baselineAnswerExact) / answers.length, comparisons: answers } } };
  await save(path.join(args.output, 'run-manifest.json'), { mode: 'local_only_replay', inputRecognitionFingerprint: manifest.fingerprint, inputFinalizedQuestionsSha256: sha256(await readFile(path.join(args.input, 'finalized-questions.json'))), input: args.input, sources: args.sources, output: args.output, modelReplies, startedAt, finishedAt, recognition: { manifestFingerprint: manifest.fingerprint, model: manifest.model, codeHash: manifest.codeHash, receipts: original.map((receipt) => ({ documentId: receipt.documentId, pageNumber: receipt.pageNumber, fingerprint: receipt.signature, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt, status: receipt.status })), receiptFingerprintsMatchManifest: original.every((receipt) => receipt.signature === manifest.fingerprint) }, currentPostprocessing: currentCode, sourceHashes, newUsage: summary.newUsage, productionWrites: false, remoteImageUploads: false, openAiClientInstantiated: false });
  await save(path.join(args.output, 'page-receipts.json'), replayReceipts);
  await save(path.join(args.output, 'finalized-questions.json'), finalized);
  await save(path.join(args.output, 'benchmark-scorecard.json'), summary);
  await mkdir(path.join(args.output, 'recognition-source'), { recursive: true });
  for (const file of ['run-manifest.json', 'page-receipts.json', 'benchmark-scorecard.json']) await copyFile(path.join(args.input, file), path.join(args.output, 'recognition-source', file));
  process.stdout.write(JSON.stringify({ output: args.output, completedQuestionPages: summary.completedQuestionPages, unresolvedPriorPages: unresolved.length, materializedQuestions: summary.materializedQuestions, preservedVisuals: summary.sourcePreservation.preservedVisuals, nativeAnswerExact: currentAnswerExact, nativeAnswerTotal: answers.length, newCalls: 0, newTokens: 0, localErrors: summary.localErrors.length }) + '\n');
  if (summary.localErrors.length > 0 || !key) process.exitCode = 1;
}

main().catch((error: unknown) => { process.stderr.write(JSON.stringify(safeError(error)) + '\n'); process.exitCode = 1; });
