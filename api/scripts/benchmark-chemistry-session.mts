/** Reproducible local shadow extraction. No production database writes or remote image uploads. */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DocumentSchema, PROMPT_KEYS, PromptKeySchema, QuestionSchema, type Document } from '@ingest/contracts';
import { env } from '../src/config/env.js';
import { OpenAiVisionExtractor } from '../src/infrastructure/ai/openai.vision-extractor.js';
import { enumerateSmilesCandidates, validateSmilesGraph } from '../src/infrastructure/ai/chemistry-audit.js';
import { PdfToImgRasterizer } from '../src/infrastructure/pdf/pdf-to-img.rasterizer.js';
import { SharpImageCropper } from '../src/infrastructure/pdf/sharp-image-cropper.js';
import { ExtractionVisualsService } from '../src/modules/extraction/extraction-visuals.service.js';
import { materializePassages } from '../src/modules/extraction/group-comprehension.js';
import { mergeAnswers } from '../src/modules/extraction/merge-answers.js';
import { toNewQuestion } from '../src/modules/extraction/extraction.worker.js';
import { normalizePrintedQuestionLabel } from '../src/modules/extraction/question-identity.js';
import { nativeChoiceSheet } from '../src/modules/extraction/native-choice-key.js';
import type { AnswerExtractionScope, AnswerSheet, ExtractedQuestion, MastersSnapshot, QuestionExtraction } from '../src/modules/extraction/index.js';
import type { NewQuestion } from '../src/modules/questions/index.js';
import type { PromptOverrides } from '../src/modules/prompts/index.js';
import type { AiTokenUsage } from '../src/modules/usage/index.js';
import { mapWithConcurrency } from '../src/shared/async/map-with-concurrency.js';
import { AppError } from '../src/shared/errors/app-error.js';

const NITROGEN_ID = '6ac130a7488c2ce717aa9661';
const ORGANIC_ID = '6abea8a437b8a045f2c79195';
const ALLEN_ID = '6abe915c01e582665eb32cfa';
const SOURCE_IDS = [NITROGEN_ID, ORGANIC_ID, ALLEN_ID];
const PAGE_CONCURRENCY = 2;
const RASTER_SCALE = 3;
const RUN_TIMEOUT_MS = 240_000;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const API_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SAFE_CHECKPOINT_NAME = /^[A-Za-z0-9_-]+$/u;
const PromptSnapshotSchema = z.object({ data: z.array(z.object({ key: PromptKeySchema, value: z.string() })) });
const MasterSnapshotSchema = z.object({ data: z.object({ entries: z.array(z.object({ id: z.string(), name: z.string(), key: z.string(), kind: z.string().nullable() })) }) });
const DocumentsSnapshotSchema = z.object({ data: z.object({ items: z.array(DocumentSchema) }) });
const BaselineSchema = z.object({
  sessionId: z.string(),
  page9MoleculeGold: z.array(z.object({ sourceLabel: z.string(), field: z.string(), goldSmiles: z.string(), graphExact: z.boolean() })),
  page9Answers: z.array(z.object({ sourceLabel: z.string(), goldAnswer: z.string(), exact: z.boolean() })),
  page9MoleculeMetrics: z.object({ total: z.number(), graphExact: z.number(), exactOptions: z.number() }),
  organicAnswerSolutionContamination: z.object({ records: z.number(), totalRecords: z.number() }),
});

type Options = { input: string; output: string; all: boolean; plan: boolean; auditOnly: boolean };
type SafeError = { name: string; message: string };
type PageTask = { document: Document; pageNumber: number };
type PageReceipt = {
  signature: string;
  documentId: string;
  pageNumber: number;
  phase: 'question' | 'answer';
  scopeKey: string | null;
  status: 'recognized' | 'complete' | 'failed';
  cached: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  usage: AiTokenUsage | null;
  extraction?: QuestionExtraction;
  drafts?: ExtractedQuestion[];
  sheets?: AnswerSheet[];
  error?: SafeError;
};
type Context = {
  options: Options;
  documents: Document[];
  pdfs: Map<string, Buffer>;
  pdfHashes: Record<string, string>;
  prompts: PromptOverrides;
  masters: MastersSnapshot;
  fingerprint: string;
  model: string;
  extractor: OpenAiVisionExtractor;
  rasterizer: PdfToImgRasterizer;
  visuals: ExtractionVisualsService;
  modelReceipts: AsyncLocalStorage<{ documentId: string; page: number; phase: string; count: number; usage: AiTokenUsage | null }>;
};

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function jsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

function parseOptions(): Options | null {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: node --conditions=development --import tsx scripts/benchmark-chemistry-session.mts --input /private/tmp/chemistry-session-audit --output /absolute/artifact/folder [--all | --audit-pages-only] [--plan]\nDefault: nitrogen page9, organic pages1/54, Allen page1, and nitrogen scoped answerpage5. --audit-pages-only sends only nitrogen9/organic1/Allen1; the answerpage5 is local-only with no vision fallback. --all runs every source page. --plan writes a network-free manifest. Completed identical checkpoints are reused.\n');
    return null;
  }
  let input = '/private/tmp/chemistry-session-audit';
  let output: string | undefined;
  let all = false;
  let plan = false;
  let auditOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') { all = true; continue; }
    if (arg === '--plan') { plan = true; continue; }
    if (arg === '--audit-pages-only') { auditOnly = true; continue; }
    if (arg === '--input' || arg === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--input') input = value; else output = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown benchmark argument: ${arg ?? ''}.`);
  }
  if (!output) throw new Error('Supply --output with a local artifact folder.');
  if (all && auditOnly) throw new Error('--all and --audit-pages-only are mutually exclusive.');
  return { input: path.resolve(input), output: path.resolve(output), all, plan, auditOnly };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && /\.(?:ts|mts)$/u.test(entry.name) ? [file] : [];
  }));
  return nested.flat();
}

async function codeSignature(): Promise<{ codeHash: string; fileHashes: Record<string, string> }> {
  const files = [...await sourceFiles(path.join(API_ROOT, 'src')), ...await sourceFiles(path.join(API_ROOT, 'contracts/src')), SCRIPT_PATH, path.join(API_ROOT, 'package.json'), path.join(API_ROOT, 'package-lock.json')].sort();
  const fileHashes: Record<string, string> = {};
  for (const file of files) fileHashes[path.relative(API_ROOT, file)] = hash(await readFile(file));
  return { codeHash: hash(JSON.stringify(fileHashes)), fileHashes };
}

function safeError(error: unknown): SafeError {
  if (error instanceof AppError) return { name: error.code, message: error.message };
  if (error instanceof Error) return { name: error.name, message: 'A local benchmark or upstream request failed; no credentials or upstream response are included.' };
  return { name: 'UnknownError', message: 'The benchmark encountered an unrecognized failure.' };
}

function checkpointFile(context: Context, phase: 'question' | 'answer', documentId: string, page: number, scope: string | null): string {
  if (!SAFE_CHECKPOINT_NAME.test(documentId)) throw new Error('A source document has an invalid local checkpoint identity.');
  const scopeHash = hash(scope ?? '').slice(0, 12);
  return path.join(context.options.output, 'checkpoints', `${phase}-${documentId}-${String(page)}-${scopeHash}-${context.fingerprint}.json`);
}

async function cachedReceipt(file: string, signature: string): Promise<PageReceipt | null> {
  try {
    const value = await jsonFile(file);
    // Checkpoints are this operator script's own versioned output, never model-returned JSON.
    const receipt = value as PageReceipt;
    return receipt.signature === signature && receipt.status !== 'failed' ? receipt : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function receiptBase(context: Context, task: PageTask, phase: 'question' | 'answer', scopeKey: string | null): PageReceipt {
  const startedAt = new Date().toISOString();
  return { signature: context.fingerprint, documentId: task.document.id, pageNumber: task.pageNumber, phase, scopeKey, status: 'failed', cached: false, startedAt, finishedAt: startedAt, durationMs: 0, usage: null };
}

async function runQuestionPage(context: Context, task: PageTask): Promise<PageReceipt> {
  const file = checkpointFile(context, 'question', task.document.id, task.pageNumber, null);
  const cached = await cachedReceipt(file, context.fingerprint);
  if (cached?.status === 'complete') return { ...cached, cached: true };
  const start = Date.now();
  let receipt = cached ?? receiptBase(context, task, 'question', null);
  try {
    const page = await context.rasterizer.rasterizePage(context.pdfs.get(task.document.id) ?? Buffer.alloc(0), task.pageNumber);
    const pagePath = path.join(context.options.output, 'pages', `${task.document.id}-${String(task.pageNumber)}.png`);
    await mkdir(path.dirname(pagePath), { recursive: true });
    await writeFile(pagePath, page.png);
    const state = { documentId: task.document.id, page: task.pageNumber, phase: 'question', count: 0, usage: null as AiTokenUsage | null };
    let extraction: QuestionExtraction;
    try {
      extraction = cached?.extraction ?? await context.modelReceipts.run(state, () => context.extractor.extractQuestions({ pages: [page], document: task.document, signal: AbortSignal.timeout(RUN_TIMEOUT_MS) }));
    } finally { if (state.usage) receipt.usage = state.usage; }
    receipt = { ...receipt, extraction, usage: extraction.usage, status: 'recognized', finishedAt: new Date().toISOString(), durationMs: Date.now() - start };
    await writeJson(file, receipt);
    const drafts = await context.visuals.preserve(task.document.id, page, extraction.questions);
    receipt = { ...receipt, drafts, status: 'complete', cached: cached !== null, finishedAt: new Date().toISOString(), durationMs: Date.now() - start };
    delete receipt.error;
    await writeJson(file, receipt);
  } catch (error) {
    receipt = { ...receipt, error: safeError(error), finishedAt: new Date().toISOString(), durationMs: Date.now() - start };
    await writeJson(file, receipt);
  }
  process.stdout.write(JSON.stringify({ phase: 'question', documentId: task.document.id, page: task.pageNumber, status: receipt.status, questions: receipt.drafts?.length ?? 0, durationMs: receipt.durationMs, error: receipt.error }) + '\n');
  return receipt;
}

async function runAnswerPage(context: Context, task: PageTask, scope: AnswerExtractionScope): Promise<PageReceipt> {
  const file = checkpointFile(context, 'answer', task.document.id, task.pageNumber, JSON.stringify(scope));
  const cached = await cachedReceipt(file, context.fingerprint);
  if (cached?.status === 'complete') return { ...cached, cached: true };
  const start = Date.now();
  let receipt = receiptBase(context, task, 'answer', scope.sectionName);
  try {
    const page = await context.rasterizer.rasterizePage(context.pdfs.get(task.document.id) ?? Buffer.alloc(0), task.pageNumber);
    const localKey = nativeChoiceSheet(page.nativeChoiceKeys, scope.expectedPrintedLabels, scope.sectionName);
    // The three-page approval does not include sending an answer page to OpenAI. This mode has
    // no vision fallback for answer sources: it uses local PDF evidence or explicitly fails.
    if (context.options.auditOnly && !localKey) throw new Error('This answer page needs additional transfer approval; local evidence did not cover every requested source identity.');
    const result = context.options.auditOnly
      ? { sheets: localKey ? [localKey] : [], usage: { model: 'native_choice_key', promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 } }
      : await context.extractor.extractAnswers({ pages: [page], document: task.document, scope, signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
    // The production worker binds this selected page range to its exact operator topic key.
    const sheets = result.sheets.map((sheet): AnswerSheet => ({ ...sheet, sectionName: scope.sectionName }));
    receipt = { ...receipt, status: 'complete', sheets, usage: result.usage, finishedAt: new Date().toISOString(), durationMs: Date.now() - start };
    await writeJson(file, receipt);
  } catch (error) {
    receipt = { ...receipt, error: safeError(error), finishedAt: new Date().toISOString(), durationMs: Date.now() - start };
    await writeJson(file, receipt);
  }
  process.stdout.write(JSON.stringify({ phase: 'answer', documentId: task.document.id, page: task.pageNumber, scope: scope.sectionName, status: receipt.status, durationMs: receipt.durationMs, error: receipt.error }) + '\n');
  return receipt;
}

function answerTasks(document: Document, source: Document, all: boolean): Array<{ task: PageTask; scope: AnswerExtractionScope }> {
  const tasks: Array<{ task: PageTask; scope: AnswerExtractionScope }> = [];
  for (const topic of document.topics) {
    for (const block of topic.types) {
      if (!block.answerPageRange || (!all && !(9 >= block.pageRange.from && 9 <= block.pageRange.to))) continue;
      const scope: AnswerExtractionScope = { sectionName: topic.name, questionType: block.questionType ?? null, ...(topic.subject ? { subject: topic.subject } : {}), questionPageRange: block.pageRange, sourcePageRange: block.answerPageRange };
      for (let pageNumber = block.answerPageRange.from; pageNumber <= block.answerPageRange.to; pageNumber += 1) tasks.push({ task: { document: source, pageNumber }, scope });
    }
  }
  return tasks;
}

async function pilotGraphScore(input: string, drafts: ExtractedQuestion[], rows: NewQuestion[]): Promise<unknown> {
  const baseline = BaselineSchema.parse(await jsonFile(path.join(input, 'baseline-scorecard.json')));
  const comparisons = await Promise.all(baseline.page9MoleculeGold.map(async (gold) => {
    const draft = drafts.find((candidate) => candidate.sourcePage === 9 && normalizePrintedQuestionLabel(candidate.printedLabel) === normalizePrintedQuestionLabel(gold.sourceLabel));
    const optionLabel = gold.field.startsWith('option-') ? gold.field.slice('option-'.length) : null;
    const text = optionLabel === null ? draft?.questionText ?? '' : draft?.options.find((option) => /^\s*\(([A-Za-z0-9]+)\)/u.exec(option)?.[1]?.toUpperCase() === optionLabel.toUpperCase()) ?? '';
    const candidates = enumerateSmilesCandidates({ stem: text }).map((candidate) => candidate.smiles);
    const reference = await validateSmilesGraph(gold.goldSmiles);
    const current = candidates[0] ? await validateSmilesGraph(candidates[0]) : null;
    const exact = candidates.length === 1 && reference.ok && current?.ok === true && reference.graph.canonicalSmiles === current.graph.canonicalSmiles;
    return { ...gold, candidateSmiles: candidates, parseValid: current?.ok === true, graphExact: exact, candidateRings: current?.ok ? current.graph.ringSizes : null, goldRings: reference.ok ? reference.graph.ringSizes : null, engineVersion: current?.ok ? current.graph.engineVersion : reference.ok ? reference.graph.engineVersion : null };
  }));
  const answers = baseline.page9Answers.map((gold) => {
    const row = rows.find((question) => question.sourceRegion.page === 9 && normalizePrintedQuestionLabel(question.printedLabel) === normalizePrintedQuestionLabel(gold.sourceLabel));
    return { ...gold, currentAnswer: row?.answer ?? null, currentExact: row?.answer.trim().toUpperCase() === gold.goldAnswer.trim().toUpperCase() };
  });
  const exact = comparisons.filter((entry) => entry.graphExact).length;
  const optionComparisons = comparisons.filter((entry) => entry.field.startsWith('option-'));
  const answerExact = answers.filter((entry) => entry.currentExact).length;
  return { scope: 'Reviewed nitrogen page9 pilot only; candidate graph accuracy is separate from source-crop fidelity.', graph: { total: comparisons.length, baselineExact: baseline.page9MoleculeMetrics.graphExact, currentExact: exact, baselinePercent: 100 * baseline.page9MoleculeMetrics.graphExact / comparisons.length, currentPercent: 100 * exact / comparisons.length, improvementPercentagePoints: 100 * (exact - baseline.page9MoleculeMetrics.graphExact) / comparisons.length }, optionGraph: { total: optionComparisons.length, baselineExact: baseline.page9MoleculeMetrics.exactOptions, currentExact: optionComparisons.filter((entry) => entry.graphExact).length }, answers: { total: answers.length, baselineExact: baseline.page9Answers.filter((entry) => entry.exact).length, currentExact: answerExact }, comparisons, answerComparisons: answers };
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (!options) return;
  await mkdir(options.output, { recursive: true });
  const documents = DocumentsSnapshotSchema.parse(await jsonFile(path.join(options.input, 'documents.json'))).data.items;
  const prompts: PromptOverrides = {};
  for (const entry of PromptSnapshotSchema.parse(await jsonFile(path.join(options.input, 'prompts.json'))).data) prompts[entry.key] = entry.value;
  const masters: MastersSnapshot = {
    questionType: MasterSnapshotSchema.parse(await jsonFile(path.join(options.input, 'masters-questionType.json'))).data.entries,
    level: MasterSnapshotSchema.parse(await jsonFile(path.join(options.input, 'masters-level.json'))).data.entries,
  };
  const sourceDocuments = SOURCE_IDS.map((id) => {
    const document = documents.find((candidate) => candidate.id === id && candidate.kind === 'question');
    if (!document) throw new Error('The source snapshot is missing a requested question document.');
    return document;
  });
  const nitrogen = sourceDocuments.find((document) => document.id === NITROGEN_ID);
  if (!nitrogen) throw new Error('The nitrogen source snapshot is missing.');
  const answerDocument = documents.find((document) => document.kind === 'answer' && document.uploadGroupId === nitrogen.uploadGroupId);
  if (!answerDocument) throw new Error('The nitrogen source snapshot is missing its bound answer document.');
  const pdfs = new Map<string, Buffer>();
  const pdfHashes: Record<string, string> = {};
  const localSources = [...sourceDocuments, answerDocument];
  for (const document of localSources) {
    const file = path.join(options.input, `${document.id}.pdf`);
    const bytes = await readFile(file);
    pdfs.set(document.id, bytes);
    pdfHashes[document.id] = hash(bytes);
  }
  const code = await codeSignature();
  const promptHash = hash(JSON.stringify({ prompts, masters, promptKeys: PROMPT_KEYS }));
  const documentHash = hash(JSON.stringify(documents));
  const fingerprint = hash(JSON.stringify({ schemaVersion: 1, codeHash: code.codeHash, promptHash, documentHash, model: env.EXTRACTION_MODEL, pdfHashes, scale: RASTER_SCALE }));
  const rasterizer = new PdfToImgRasterizer(RASTER_SCALE);
  const pageCounts: Record<string, number> = {};
  const tasks: PageTask[] = [];
  for (const document of sourceDocuments) {
    const count = await rasterizer.pageCount(pdfs.get(document.id) ?? Buffer.alloc(0));
    pageCounts[document.id] = count;
    const selected = options.all ? Array.from({ length: count }, (_, index) => index + 1) : document.id === NITROGEN_ID ? [9] : document.id === ORGANIC_ID ? (options.auditOnly ? [1] : [1, 54]) : [1];
    for (const pageNumber of selected) {
      if (pageNumber > count) throw new Error('A smoke case exceeds its source PDF page count.');
      tasks.push({ document, pageNumber });
    }
  }
  const boundAnswers = answerTasks(nitrogen, answerDocument, options.all);
  const manifest = { schemaVersion: 1, sessionId: nitrogen.sessionId, mode: options.all ? 'all-source-pages' : options.auditOnly ? 'approved-three-page-pilot' : 'smoke', fingerprint, model: env.EXTRACTION_MODEL, codeHash: code.codeHash, codeFileHashes: code.fileHashes, promptHash, documentHash, pdfHashes, sourceSnapshots: { input: options.input, files: ['documents.json', 'prompts.json', 'masters-questionType.json', 'masters-level.json', 'baseline-scorecard.json'] }, rasterScale: RASTER_SCALE, pageConcurrency: PAGE_CONCURRENCY, questionConcurrency: 3, timeoutMs: RUN_TIMEOUT_MS, pageCounts, selectedPages: tasks.map((task) => ({ documentId: task.document.id, pageNumber: task.pageNumber })), answerScopes: boundAnswers.map(({ task, scope }) => ({ documentId: task.document.id, pageNumber: task.pageNumber, scope })), answerExtractionMode: options.auditOnly ? 'local-native-key-no-vision-fallback' : 'native-key-or-vision', productionWrites: false, remoteImageUploads: false };
  await writeJson(path.join(options.output, 'run-manifest.json'), manifest);
  await mkdir(path.join(options.output, 'sources'), { recursive: true });
  for (const filename of manifest.sourceSnapshots.files) await copyFile(path.join(options.input, filename), path.join(options.output, 'sources', filename));
  if (options.plan) {
    process.stdout.write(JSON.stringify({ plan: true, fingerprint, questionPages: tasks.length, answerPages: boundAnswers.length, output: options.output }) + '\n');
    return;
  }
  if (!env.OPENAI_API_KEY) throw new Error('Configure the existing API OPENAI_API_KEY before running the benchmark.');
  const cropDirectory = path.join(options.output, 'crops');
  const visuals = new ExtractionVisualsService({ upload: async (name, bytes) => {
    const target = path.resolve(cropDirectory, name);
    if (!target.startsWith(cropDirectory + path.sep)) throw new Error('A local crop path escaped its output directory.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return target;
  } }, new SharpImageCropper());
  const modelReceipts: Context['modelReceipts'] = new AsyncLocalStorage();
  const extractor = new OpenAiVisionExtractor(env.OPENAI_API_KEY, env.EXTRACTION_MODEL, () => Promise.resolve(prompts), () => Promise.resolve(masters), async (receipt) => {
    const state = modelReceipts.getStore();
    if (!state) return;
    state.count += 1;
    state.usage = receipt.usage;
    await writeJson(path.join(options.output, 'model-replies', `${state.phase}-${state.documentId}-${String(state.page)}-${fingerprint}-call-${String(state.count)}.json`), receipt);
  });
  const context: Context = { options, documents, pdfs, pdfHashes, prompts, masters, fingerprint, model: env.EXTRACTION_MODEL, extractor, rasterizer, visuals, modelReceipts };
  const startedAt = new Date().toISOString();
  const questionReceipts = await mapWithConcurrency(tasks, PAGE_CONCURRENCY, (task) => runQuestionPage(context, task));
  const answerReceipts = await mapWithConcurrency(boundAnswers, PAGE_CONCURRENCY, ({ task, scope }) => {
    const expectedPrintedLabels = [...new Set(questionReceipts.filter((receipt) => receipt.documentId === NITROGEN_ID && receipt.status === 'complete').flatMap((receipt) => receipt.drafts ?? []).filter((draft) => draft.sourcePage >= scope.questionPageRange.from && draft.sourcePage <= scope.questionPageRange.to).flatMap((draft) => draft.printedLabel ? [draft.printedLabel] : []))];
    return runAnswerPage(context, task, { ...scope, expectedPrintedLabels });
  });
  const finalized: Array<{ documentId: string; drafts: ExtractedQuestion[]; rows: NewQuestion[]; passages: unknown[]; errors: SafeError[] }> = [];
  for (const document of sourceDocuments) {
    const receipts = questionReceipts.filter((receipt) => receipt.documentId === document.id && receipt.status === 'complete');
    const drafts = receipts.flatMap((receipt) => receipt.drafts ?? []);
    const sourceSheets = receipts.flatMap((receipt) => receipt.extraction?.sheets ?? []);
    const siblingSheets = document.id === NITROGEN_ID ? answerReceipts.flatMap((receipt) => receipt.sheets ?? []) : [];
    const answered = mergeAnswers(drafts, [...sourceSheets, ...siblingSheets], document.topics);
    const grouped = materializePassages(answered, document.id);
    const rows: NewQuestion[] = [];
    const errors: SafeError[] = [];
    for (const draft of grouped.drafts) {
      try { rows.push(toNewQuestion(document, draft, { model: context.model, at: startedAt })); }
      catch (error) { errors.push(safeError(error)); }
    }
    finalized.push({ documentId: document.id, drafts: answered, rows, passages: grouped.passages, errors });
  }
  const nitrogenResult = finalized.find((result) => result.documentId === NITROGEN_ID);
  const pilot = await pilotGraphScore(options.input, nitrogenResult?.drafts ?? [], nitrogenResult?.rows ?? []);
  const rawDrafts = questionReceipts.flatMap((receipt) => receipt.extraction?.questions ?? []);
  const candidates = enumerateSmilesCandidates(rawDrafts);
  const validations = await Promise.all(candidates.map((candidate) => validateSmilesGraph(candidate.smiles)));
  const visualsDetected = rawDrafts.flatMap((draft) => draft.chemistry?.visuals ?? []).length;
  const preserved = finalized.flatMap((result) => result.drafts.flatMap((draft) => draft.chemistry?.visuals ?? []));
  const contaminatedPages = questionReceipts.filter((receipt) => receipt.documentId === ORGANIC_ID && receipt.pageNumber >= 42 && receipt.pageNumber <= 54 && receipt.status === 'complete');
  const baselineOrganic = z.object({ data: z.object({ questions: z.array(QuestionSchema) }) }).parse(await jsonFile(path.join(options.input, `questions-${ORGANIC_ID}.json`))).data.questions;
  const testedContaminationPages = contaminatedPages.map((receipt) => receipt.pageNumber);
  const receipts = [...questionReceipts, ...answerReceipts];
  const errors = [...receipts.filter((receipt) => receipt.error).map((receipt) => ({ documentId: receipt.documentId, page: receipt.pageNumber, phase: receipt.phase, error: receipt.error })), ...finalized.flatMap((result) => result.errors.map((error) => ({ documentId: result.documentId, phase: 'materialization', error })))];
  const tokenUsage = receipts.reduce((total, receipt) => ({ promptTokens: total.promptTokens + (receipt.usage?.promptTokens ?? 0), completionTokens: total.completionTokens + (receipt.usage?.completionTokens ?? 0), totalTokens: total.totalTokens + (receipt.usage?.totalTokens ?? 0), callCount: total.callCount + (receipt.usage?.callCount ?? 0) }), { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 });
  const summary = { fingerprint, mode: manifest.mode, model: context.model, startedAt, finishedAt: new Date().toISOString(), plannedQuestionPages: tasks.length, completedQuestionPages: questionReceipts.filter((receipt) => receipt.status === 'complete').length, reusedCheckpoints: receipts.filter((receipt) => receipt.cached).length, materializedQuestions: finalized.reduce((sum, result) => sum + result.rows.length, 0), errors, tokenUsage, candidateSmiles: { total: candidates.length, parseValid: validations.filter((validation) => validation.ok).length, invalid: validations.filter((validation) => !validation.ok).length, graphAccuracyClaim: false }, sourcePreservation: { detectedVisuals: visualsDetected, preservedVisuals: preserved.filter((visual) => visual.cropUrl).length, questionsWithSourceCrop: finalized.flatMap((result) => result.rows).filter((row) => row.isQuestionImage || row.isOptionImage).length, ownershipAndCompletenessRequireReview: true }, answerSolutionContamination: { testedPages: testedContaminationPages, totalTargetPages: 13, baselineQuestionsOnTestedPages: baselineOrganic.filter((question) => testedContaminationPages.includes(question.sourceRegion.page)).length, currentQuestionsOnTestedPages: contaminatedPages.reduce((sum, receipt) => sum + (receipt.drafts?.length ?? 0), 0), entireRangeTested: testedContaminationPages.length === 13 }, pilot };
  await writeJson(path.join(options.output, 'page-receipts.json'), receipts);
  await writeJson(path.join(options.output, 'finalized-questions.json'), finalized);
  await writeJson(path.join(options.output, 'benchmark-scorecard.json'), summary);
  process.stdout.write(JSON.stringify({ output: options.output, completedQuestionPages: summary.completedQuestionPages, plannedQuestionPages: tasks.length, materializedQuestions: summary.materializedQuestions, errors: errors.length, totalTokens: tokenUsage.totalTokens }) + '\n');
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(JSON.stringify(safeError(error)) + '\n');
  process.exitCode = 1;
});
