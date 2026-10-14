import { OpenAI } from 'openai';
import type { ChemistryExtraction, Document, MatchData } from '@ingest/contracts';
import { KNOWN_LEVELS } from '@ingest/contracts';
import type {
  AnswerExtraction,
  AnswerExtractionScope,
  AnswerSheet,
  ExtractedQuestion,
  ExtractionProgress,
  MastersSnapshot,
  PageImage,
  QuestionExtraction,
  VisionExtractor,
} from '../../modules/extraction/index.js';
import { isChemistryDocument, nativeChoiceSheet, normalizePrintedQuestionLabel, questionNumberFromPrintedLabel, topicBindingForPage } from '../../modules/extraction/index.js';
import { mergeAnswerEntries, type AnswerSource } from '../../modules/extraction/vision-extractor.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { answerPrompt, companionPrompt, questionPrompt, solutionPrompt } from './prompts/extraction-prompts.js';
import { sanitizeExtractedLatex } from './latex-sanitizer.js';
import type { PromptOverrides } from '../../modules/prompts/index.js';
import { mapWithConcurrency } from '../../shared/async/map-with-concurrency.js';
import { createChemistryInventoryPreview } from './chemistry-inventory-preview.js';
import { attachChemistryAnswerSources, CHEMISTRY_ANSWER_SOURCE_RULE, parsedAnswerSourceRegions, parsedAnswerVisualKinds } from './chemistry-answer-sources.js';
import {
  enumerateSmilesCandidates, validateSmilesGraph,
} from './chemistry-audit.js';
import {
  applySourceTopologyAudit, CHEMISTRY_TOPOLOGY_AUDIT_PROMPT, CHEMISTRY_TOPOLOGY_RESPONSE_FORMAT,
  answerSourceOwnership, declaredMolecularSourceFields, molecularTextAtPointer, prepareSourceTopologyAudit, type ChemistrySourceScope, type MolecularTopologyAudit,
} from './chemistry-topology.schema.js';
import {
  CHEMISTRY_INVENTORY_JSON_SCHEMA, CHEMISTRY_INVENTORY_PROMPT, chemistryCropBox, chemistrySourceBox,
  chemistryQuestionRegions, chemistryStemRegions, cropChemistryImage, cropChemistryRegions, parseChemistryInventory, type ChemistryQuestionRegion,
} from './chemistry-page-inventory.js';

/**
 * Output-token budget for the first attempt at one page. Covers a reasoning model's hidden reasoning
 * AND the page's question JSON; the retry doubles it once if the model still truncates.
 */
const MAX_TOKENS = 16000;
type AuditImages = { stem: Buffer; options: Buffer[]; requireCoverage?: boolean; requireAnswerCoverage?: boolean; expectedAnswerCounts?: ChemistrySourceScope[]; skipAudit?: boolean };
type MolecularCallResult = { content: string; molecularAudits?: MolecularTopologyAudit[]; chemistryIssues?: string[]; sourceCounts?: ChemistrySourceScope[] };
type RegionQuestion = { raw: RawQuestion; region?: ChemistryQuestionRegion; molecularAudits?: MolecularTopologyAudit[]; chemistryIssues?: string[] };
export type ExtractionModelReceipt = { phase: 'inventory' | 'transcription' | 'audit'; content: string; usage: AiTokenUsage };

/** Shape the question prompt asks the model to return, before we enrich with section/page. */
type RawQuestion = {
  question_number?: unknown;
  printed_label?: unknown;
  question_text?: unknown;
  options?: unknown;
  /** Only present for comprehension questions — the shared passage, repeated on each sub-question. */
  passage?: unknown;
  /** The question's own type, classified by the model (one of KNOWN_QUESTION_TYPES) — for every
   *  question, and for each comprehension sub-question (a group holds questions of any type). */
  question_type?: unknown;
  /** The question's difficulty, classified by the model — one of KNOWN_LEVELS (easy/medium/hard). */
  difficulty?: unknown;
  /** The model's 0–1 confidence in its difficulty classification. */
  difficulty_confidence?: unknown;
  /** Only present for matrix-match questions — the ordered columns and (optionally) the answer key. */
  columns?: unknown;
  match?: unknown;
  /** Present only when the question page itself prints the answer / worked solution. */
  answer?: unknown;
  explanation?: unknown;
  /** Present only on a PYQ segment — the source exam + year the model read off the page. */
  pyq_exam?: unknown;
  pyq_year?: unknown;
};

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  // Vision models naturally emit bare JSON numbers for numerical answers. Coercing finite scalar
  // values here keeps a correct `42` from becoming an empty answer before the merge stage.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

function answerSourcePrompt(prompt: string, document: Document, subject?: string): string {
  return isChemistryDocument(subject ? { ...document, subject } : document) ? `${prompt}\n\n${CHEMISTRY_ANSWER_SOURCE_RULE}` : prompt;
}

function answerAuditImages(png: Buffer, document: Document, subject?: string): AuditImages | undefined {
  return isChemistryDocument(subject ? { ...document, subject } : document) ? { stem: png, options: [], requireAnswerCoverage: true } : undefined;
}

/** A model string with its mhchem `\ce{…}` JSON-escape corruption repaired (see {@link sanitizeExtractedLatex}). */
function cleanString(value: unknown): string {
  return sanitizeExtractedLatex(asString(value));
}

/** Non-empty repaired string, or null — for answers/explanations kept as an explicit absence. */
function cleanStringOrNull(value: unknown): string | null {
  const text = sanitizeExtractedLatex(asString(value)).trim();
  return text.length > 0 ? text : null;
}

/** The model's difficulty, normalized to the closed vocabulary (easy/medium/hard) — else null. */
function normalizeDifficulty(value: unknown): string | null {
  const text = asString(value).trim().toLowerCase();
  return (KNOWN_LEVELS as readonly string[]).includes(text) ? text : null;
}

/** A model-reported 0–1 difficulty confidence, or null for legacy/custom prompt replies. */
function normalizeDifficultyConfidence(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^0(?:\.\d+)?$|^1(?:\.0+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : null;
}

/**
 * Build structured match-the-column data from a matrix question's raw `columns`/`match`. Returns null
 * unless at least two well-formed columns are present, so a non-matrix (or malformed) response simply
 * falls back to the ordinary question path. The key keeps only string→string[] entries.
 */
function toMatchData(rawColumns: unknown, rawMatch: unknown): MatchData | null {
  if (!Array.isArray(rawColumns)) return null;
  const columns: MatchData['columns'] = [];
  for (const rawColumn of rawColumns) {
    const record = rawColumn as { title?: unknown; entries?: unknown };
    const entries = Array.isArray(record.entries)
      ? record.entries
          .map((rawEntry) => {
            const entry = rawEntry as { label?: unknown; body?: unknown };
            return { label: asString(entry.label).trim(), body: cleanString(entry.body), image: null };
          })
          .filter((entry) => entry.label.length > 0)
      : [];
    if (entries.length > 0) columns.push({ title: cleanString(record.title), entries });
  }
  if (columns.length < 2) return null;

  const key: Record<string, string[]> = {};
  if (rawMatch && typeof rawMatch === 'object') {
    for (const [label, targets] of Object.entries(rawMatch as Record<string, unknown>)) {
      const list = Array.isArray(targets)
        ? targets.map(asString).map((t) => t.trim()).filter(Boolean)
        : [];
      if (list.length > 0) key[label.trim()] = list;
    }
  }
  return { columns, key };
}

function toQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const number = Math.trunc(value);
    return number > 0 ? number : null;
  }
  // Answer papers and question pages commonly write `Q1`, `Question 1`, or `1.`. Treat the
  // printed ordinal as the identity, rather than requiring the model to strip that decoration.
  return questionNumberFromPrintedLabel(asString(value));
}

function parseQuestions(content: string): RawQuestion[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const questions = (parsed as { questions?: unknown }).questions;
    return Array.isArray(questions) ? (questions as RawQuestion[]) : [];
  } catch {
    return [];
  }
}

function molecularCoverageIssues(raw: RawQuestion, region: ChemistryQuestionRegion): string[] {
  const issues: string[] = [];
  const stemCount = enumerateSmilesCandidates({ question_text: raw.question_text, passage: raw.passage, columns: raw.columns }).length;
  if (region.molecule_count !== undefined && stemCount !== region.molecule_count) issues.push(`Question ${region.printed_label ?? '(unlabelled)'} stem: ${String(stemCount)} SMILES molecules were transcribed for ${String(region.molecule_count)} independently counted source drawings.`);
  const options = Array.isArray(raw.options) ? raw.options : [];
  for (const [index, option] of region.options.entries()) {
    const count = enumerateSmilesCandidates({ options: [options[index]] }).length;
    if (option.molecule_count !== undefined && count !== option.molecule_count) issues.push(`Question ${region.printed_label ?? '(unlabelled)'} option ${option.label}: ${String(count)} SMILES molecules were transcribed for ${String(option.molecule_count)} independently counted source drawings.`);
  }
  return issues;
}

/** Non-empty string, or null — used to keep blank answers/explanations as an explicit absence. */
function asStringOrNull(value: unknown): string | null {
  const text = asString(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Preserve either batch prompt option shape. The primary extraction prompt uses strings, while an
 * edited/custom prompt may return the object shape used by interactive re-extraction. Converting an
 * object to the one canonical `(label) body` representation keeps the worker parser and answer
 * matching identical in both paths instead of silently erasing every option.
 */
function normaliseOption(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = cleanString(value).trim();
    return text || null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as { label?: unknown; body?: unknown };
  const label = cleanString(record.label).trim();
  const body = cleanString(record.body).trim();
  if (!label) return body || null;
  return body ? `(${label}) ${body}` : `(${label})`;
}

/**
 * Custom extraction prompts sometimes emit the interactive option-object shape and mark the right
 * choice with `is_correct`, but omit the separate `answer` scalar. Preserve that explicit signal
 * before the worker flattens the option objects; otherwise a perfectly readable matrix/MCQ arrives
 * in Verify with its choices but no answer.
 */
function answerFromMarkedOptions(raw: unknown, questionType: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const labels = raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as { label?: unknown; is_correct?: unknown };
    const label = cleanString(record.label).trim();
    return record.is_correct === true && label ? [label] : [];
  });
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0] ?? null;
  if (asString(questionType).trim().toLowerCase() !== 'multi_correct') return null;
  return labels.every((label) => /^[A-Za-z0-9]$/.test(label))
    ? labels.join('')
    : labels.join(', ');
}

/** Normalise a printed answer-map key (`Q1`, `Question 1`, `1.`) to the question ledger key. */
function normaliseAnswerMapKey(value: string): string | null {
  return normalizePrintedQuestionLabel(value);
}

function toAnswerEntry(value: unknown, answerSource: AnswerSource): AnswerSheet['entries'][string] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as { answer?: unknown; explanation?: unknown };
    const sourceRegions = parsedAnswerSourceRegions(value);
    const sourceVisualKinds = parsedAnswerVisualKinds(value);
    return {
      answer: cleanStringOrNull(record.answer),
      explanation: cleanStringOrNull(record.explanation),
      answerSource,
      ...(sourceRegions.length > 0 ? { sourceRegions } : {}),
      ...(sourceVisualKinds ? { sourceVisualKinds } : {}),
    };
  }
  return { answer: cleanStringOrNull(value), explanation: null, answerSource };
}

/** Fold a response map into one section, preserving source priority and page-break continuations. */
function appendEntries(
  entries: AnswerSheet['entries'],
  values: unknown,
  answerSource: AnswerSource,
): void {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const questionNumber = normaliseAnswerMapKey(key);
    if (!questionNumber) continue;
    entries[questionNumber] = mergeAnswerEntries(
      entries[questionNumber],
      toAnswerEntry(value, answerSource),
    );
  }
}

/** True when one map is a worked-solution page rather than a terse answer-key page. */
function containsWorking(values: unknown): boolean {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  return Object.values(values as Record<string, unknown>).some(
    (value) => toAnswerEntry(value, 'solution').explanation !== null,
  );
}

/** Parse an answer-sheet response, accepting compact values and a combined `{answer, explanation}` entry. */
function parseAnswerSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; answers?: unknown; solutions?: unknown };
      const entries: AnswerSheet['entries'] = {};
      // The source document itself is an answer key, so it stays canonical even if an operator
      // override calls the map `solutions` by mistake.
      appendEntries(entries, record.answers, 'answer_key');
      appendEntries(entries, record.solutions, 'answer_key');
      return { sectionName: asString(record.section_name) || fallbackSection, entries };
    });
  } catch {
    return [];
  }
}

/** Parse a solution response, accepting either map name without dropping one when both are present. */
function parseSolutionSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; solutions?: unknown; answers?: unknown };
      const entries: AnswerSheet['entries'] = {};
      appendEntries(entries, record.solutions, 'solution');
      appendEntries(entries, record.answers, 'solution');
      return { sectionName: asString(record.section_name) || fallbackSection, entries };
    });
  } catch {
    return [];
  }
}

/**
 * Parse a grouped companion. The companion prompt uses a `solutions` map for both terse answer-key
 * pages and full worked-solution pages, so classify the whole rendered page by whether any entry
 * contains working. This means an answer-key page wins regardless of whether it appears before or
 * after a solution page, while a solution-only companion still supplies a usable final answer.
 */
function parseCompanionSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; solutions?: unknown; answers?: unknown };
      const entries: AnswerSheet['entries'] = {};
      // Be tolerant of an override that returns the intuitive `answers` map: it is explicitly an
      // answer-key source. The documented companion `solutions` map is classified by page content.
      appendEntries(entries, record.answers, 'answer_key');
      appendEntries(entries, record.solutions, containsWorking(record.solutions) ? 'solution' : 'answer_key');
      return { sectionName: asString(record.section_name) || fallbackSection, entries };
    });
  } catch {
    return [];
  }
}

function withSheetMolecularAudits(sheets: AnswerSheet[], result: MolecularCallResult, documentId: string, pageNumber: number): AnswerSheet[] {
  const ownedEntry = (path: string): { sectionIndex: number; label: string | null } | null => {
    const match = /^\/sections\/(\d+)\/(?:answers|solutions)\/([^/]+)(?:\/|$)/.exec(path);
    if (!match?.[1] || !match[2]) return null;
    return { sectionIndex: Number(match[1]), label: normalizePrintedQuestionLabel(match[2].replaceAll('~1', '/').replaceAll('~0', '~')) };
  };
  return sheets.map((sheet, sectionIndex) => ({ ...sheet, entries: Object.fromEntries(Object.entries(sheet.entries).map(([label, entry]) => {
    const audits = (result.molecularAudits ?? []).filter((audit) => {
      const owner = ownedEntry(audit.fieldPath);
      return owner?.sectionIndex === sectionIndex && owner.label === label;
    }).map((audit) => ({ ...audit, fieldPath: /\/(?:answer|explanation)$/.test(audit.fieldPath) ? audit.fieldPath : `${audit.fieldPath}/answer`, sourceDocumentId: documentId, sourcePage: pageNumber }));
    const issues = (result.chemistryIssues ?? []).filter((issue) => {
      const path = /^\/sections\/\d+\/(?:answers|solutions)\/[^\s:]+/.exec(issue)?.[0];
      const owner = path ? ownedEntry(path) : null;
      return owner ? owner.sectionIndex === sectionIndex && owner.label === label : audits.some((audit) => audit.status === 'unresolved') || (result.sourceCounts ?? []).some((source) => {
        const sourceOwner = ownedEntry(source.fieldPath);
        return source.moleculeCount > 0 && sourceOwner?.sectionIndex === sectionIndex && sourceOwner.label === label;
      });
    });
    const sourceMoleculeCounts: NonNullable<AnswerSheet['entries'][string]['sourceMoleculeCounts']> = { ...entry.sourceMoleculeCounts };
    for (const source of result.sourceCounts ?? []) {
      const owner = ownedEntry(source.fieldPath);
      if (owner?.sectionIndex !== sectionIndex || owner.label !== label) continue;
      const field = source.fieldPath.endsWith('/explanation') ? 'explanation' : 'answer';
      sourceMoleculeCounts[field] = source.moleculeCount;
    }
    return [label, { ...entry, ...(audits.length ? { molecularAudits: [...(entry.molecularAudits ?? []), ...audits] } : {}), ...(issues.length ? { chemistryIssues: [...new Set([...(entry.chemistryIssues ?? []), ...issues])] } : {}), ...(Object.keys(sourceMoleculeCounts).length ? { sourceMoleculeCounts } : {}) }];
  })) }));
}

/**
 * {@link VisionExtractor} backed by an OpenAI vision model — the TypeScript port of the Python
 * extractor's OpenAI service. One image per call (serial, like the Python default) for reliable JSON,
 * `response_format: json_object`. Model-agnostic: works on gpt-4o and on the newer reasoning models
 * (e.g. gpt-5.4-mini) via `max_completion_tokens` (see {@link OpenAiVisionExtractor.call}). Runs in
 * the worker, never the API request path.
 */
export class OpenAiVisionExtractor implements VisionExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly loadPromptOverrides: () => Promise<PromptOverrides>,
    // A live snapshot of the closed masters dimensions (questionType / level) so the classification
    // prompt lists the OPERATOR-managed vocabulary, not a hardcoded constant. Cached upstream.
    private readonly loadMasters: () => Promise<MastersSnapshot>,
    private readonly onModelReceipt?: (receipt: ExtractionModelReceipt) => Promise<void>,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extractQuestions(input: {
    pages: PageImage[];
    document: Document;
    signal?: AbortSignal;
    onProgress?: (progress: ExtractionProgress) => Promise<void>;
  }): Promise<QuestionExtraction> {
    const results: ExtractedQuestion[] = [];
    const sourceSheets: AnswerSheet[] = [];
    const usage = this.emptyUsage();
    const pagesTotal = input.pages.length;
    let pagesDone = 0;
    const overrides = await this.loadPromptOverrides();
    // The live masters vocabulary for the closed classification dimensions — fetched once per run so the
    // prompt lists the current questionType / level rows (dynamic; a rename/edit needs no code change).
    const masters = await this.loadMasters();
    for (const page of input.pages) {
      // Per page: the topic config can bind different pages to different fixed question types.
      const prompt = questionPrompt(input.document, page.pageNumber, overrides, masters);
      const read = isChemistryDocument(input.document)
        ? await this.readChemistryPage(prompt, page, input.document, overrides, usage, input.signal)
        : { questions: (await this.readPageQuestions(prompt, page, input.document, usage, input.signal)).map((raw): RegionQuestion => ({ raw })), sheets: [] };
      sourceSheets.push(...read.sheets);
      const boundType = topicBindingForPage(input.document.topics, page.pageNumber)?.questionType
        ?? input.document.questionType;
      for (const { raw, region, molecularAudits, chemistryIssues } of read.questions) {
        const questionType = asStringOrNull(raw.question_type);
        // A model occasionally preserves the documented `is_correct` flags but omits question_type.
        // On an operator-locked multi-correct page, that used to discard every marked answer because
        // `answerFromMarkedOptions` did not know that several labels were valid. The fixed cut-time
        // type is safe as a fallback; a comprehension container deliberately remains unbound because
        // each child has its own type.
        const answerType = questionType ?? (boundType === 'comprehension' ? null : boundType);
        const printedLabel = normalizePrintedQuestionLabel(region?.printed_label ?? (asString(raw.printed_label) || asString(raw.question_number)));
        const chemistry = region ? await this.chemistryMetadata(raw, region, input.document.id, page.pageNumber, molecularAudits, chemistryIssues) : null;
        results.push({
          questionNumber: toQuestionNumber(raw.question_number),
          printedLabel,
          ...(region ? { sourceBbox: chemistrySourceBox(region.bbox) } : {}),
          chemistry,
          questionText: cleanString(raw.question_text),
          options: Array.isArray(raw.options)
            ? raw.options.map(normaliseOption).filter((option): option is string => option !== null)
            : [],
          answer: cleanStringOrNull(raw.answer) ?? answerFromMarkedOptions(raw.options, answerType),
          explanation: cleanStringOrNull(raw.explanation),
          sectionName: region?.source_section ?? input.document.sectionName,
          // The model now classifies each question's own type (and difficulty). Null when it returned
          // nothing usable — toNewQuestion falls back to the operator's binding for the type.
          questionType,
          level: normalizeDifficulty(raw.difficulty),
          difficultyConfidence: normalizeDifficultyConfidence(raw.difficulty_confidence),
          sourcePage: page.pageNumber,
          pyqExam: asStringOrNull(raw.pyq_exam),
          pyqYear: asStringOrNull(raw.pyq_year),
          match: toMatchData(raw.columns, raw.match),
          passage: cleanStringOrNull(raw.passage),
          // passageId/groupOrder are assigned later by materializePassages (post answer-merge), not here.
          passageId: null,
          groupOrder: null,
        });
      }
      pagesDone += 1;
      if (input.onProgress) {
        await input.onProgress({ pagesTotal, pagesDone, questionsFound: results.length });
      }
    }
    logger.info(
      { documentId: input.document.id, model: this.model, pages: input.pages.length, questions: results.length },
      'question extraction done',
    );
    return { questions: results, usage, sheets: sourceSheets };
  }

  /** Inventory independently of model-generated tags, then read one owned question at a time. */
  private async readChemistryPage(
    prompt: string,
    page: PageImage,
    document: Document,
    overrides: PromptOverrides,
    usage: AiTokenUsage,
    signal?: AbortSignal,
  ): Promise<{ questions: RegionQuestion[]; sheets: AnswerSheet[] }> {
    const preview = await createChemistryInventoryPreview(page.png);
    const inventoryReply = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: MAX_TOKENS,
      response_format: { type: 'json_schema', json_schema: CHEMISTRY_INVENTORY_JSON_SCHEMA },
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${CHEMISTRY_INVENTORY_PROMPT}\n\n${preview.coordinateInstructions}${page.layout ? `\nVISIBLE SOURCE ANCHORS (from source coordinates): ${JSON.stringify(page.layout.questions.map((question) => ({ printed_label: question.printedLabel, source_section: question.sourceSection, bbox: question.bbox.map((coordinate) => Math.round(coordinate * 1000)), option_labels: question.options.map((option) => option.label) })))}` : ''}` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${preview.png.toString('base64')}`, detail: 'high' } },
      ] }],
    }, signal ? { signal } : undefined);
    this.accumulateUsage(usage, inventoryReply.usage);
    await this.onModelReceipt?.({ phase: 'inventory', content: inventoryReply.choices[0]?.message.content ?? '', usage: { ...usage } });
    if (inventoryReply.choices[0]?.finish_reason === 'length') throw errors.extractionFailed('Chemistry source inventory was truncated; no page was accepted.');
    const inventory = parseChemistryInventory(inventoryReply.choices[0]?.message.content ?? '', page.layout);
    if (inventory.page_role === 'empty') return { questions: [], sheets: [] };
    if (inventory.page_role === 'answers' || inventory.page_role === 'solutions') {
      // Separate answer/solution pages inside a question PDF enrich existing identities, never create rows.
      const sourcePrompt = `${companionPrompt(document, page.pageNumber, overrides)}\n\n${CHEMISTRY_ANSWER_SOURCE_RULE}`;
      const result = await this.call(sourcePrompt, page.png, usage, signal, answerAuditImages(page.png, document));
      const sheets = inventory.page_role === 'answers' ? parseAnswerSheets(result.content, document.sectionName) : parseSolutionSheets(result.content, document.sectionName);
      return { questions: [], sheets: await attachChemistryAnswerSources(withSheetMolecularAudits(sheets, result, document.id, page.pageNumber), document, page) };
    }
    const questions = await mapWithConcurrency(inventory.question_regions, 3, async (region): Promise<RegionQuestion> => {
      const png = await cropChemistryRegions(page.png, chemistryQuestionRegions(region));
      const stemRegions = chemistryStemRegions(region);
      const stem = stemRegions.length > 0 ? await cropChemistryRegions(page.png, stemRegions) : png;
      const options = await Promise.all(region.options.map((option) => cropChemistryImage(page.png, option.bbox)));
      const ownership = [
        'LOCALIZED SOURCE OWNERSHIP: this image contains exactly ONE source question. Return exactly one questions entry.',
        `Preserve its printed_label as ${JSON.stringify(region.printed_label)}. Keep its numeric ordinal in question_number; never remove the printed prefix.`,
        'Confirm that this exact printed label is visible. Never relabel a different question as the requested target. If the crop is missing its target or contains part of a neighboring question, return questions: [] rather than guessing its ownership.',
        `The independently inventoried source options, in order, are ${JSON.stringify(region.options.map((option) => option.label))}. Preserve this exact panel even if a classification rule says the question type normally has no options. Do not invent absent choices.`,
        'Every arrow/step, reagent, above/below condition and intermediate label is part of the question. Represent all printed relationships; never infer products. Read drawn bonds from this enlarged crop, counting ring vertices and tracing carbonyl/heteroatom attachment.',
        'SMILES-FIRST TRANSCRIPTION: represent EVERY clearly drawn molecule in question_text, each option, matrix entry and passage at its original printed position as <smiles>RAW_SMILES</smiles>. This includes simple benzene/phenol rings and EACH reactant, intermediate and product in a multi-step reaction. A question crop is recognition input only; it is not the extracted answer. Never write "See source diagram", "structure shown", molecule names, or empty text in place of a readable drawing. Preserve text, arrows, reagent conditions, intermediate labels, subpart numbering and all molecules together. When an individual drawing truly cannot be read, write [Unresolved molecular structure: specific reason] exactly in its slot; do not replace the rest of the question.',
        ...(region.source_regions.length > 1 ? ['This one question continues across columns. The original source parts are stacked in reading order with a white gap. Preserve every continued statement and the choices from the final part; the gap does not create another question.'] : []),
      ].join('\n');
      const auditImages = { stem, options, requireCoverage: region.visual_kind === 'molecule' || region.visual_kind === 'reaction' || region.options.some((option) => option.visual_kind === 'molecule' || option.visual_kind === 'reaction') };
      let primary = await this.call(`${prompt}\n\n${ownership}`, png, usage, signal, { ...auditImages, skipAudit: true });
      let initialRaw = parseQuestions(primary.content)[0];
      let missing = initialRaw ? molecularCoverageIssues(initialRaw, region) : [];
      if (missing.length > 0) {
        primary = await this.call(`${prompt}\n\n${ownership}\n\nINCOMPLETE MOLECULAR TRANSCRIPTION: the independently counted source drawings and your SMILES count disagree. Re-read every individual drawing and return the complete same question JSON with all readable structures in their original positions. Do not add crop placeholders or guessed products.\n${missing.join('\n')}`, png, usage, signal, { ...auditImages, skipAudit: true });
        initialRaw = parseQuestions(primary.content)[0];
        missing = initialRaw ? molecularCoverageIssues(initialRaw, region) : missing;
      }
      const { content, molecularAudits, chemistryIssues } = await this.auditMolecularContent(primary.content, png, usage, signal, auditImages);
      const raws = parseQuestions(content);
      if (raws.length !== 1 || !raws[0]) throw errors.extractionFailed('A localized chemistry question returned a missing or merged question; the page requires review.');
      const raw = raws[0];
      const returnedLabel = normalizePrintedQuestionLabel(asString(raw.printed_label) || asString(raw.question_number));
      const inventoriedLabel = normalizePrintedQuestionLabel(region.printed_label);
      const hasExplicitPrefix = typeof raw.printed_label === 'string' || (returnedLabel !== null && /[A-Z]/.test(returnedLabel));
      const identityMismatch = hasExplicitPrefix ? returnedLabel !== inventoriedLabel : (toQuestionNumber(raw.question_number) !== questionNumberFromPrintedLabel(inventoriedLabel));
      if (inventoriedLabel !== null && (returnedLabel === null || identityMismatch)) throw errors.extractionFailed('Localized recognition returned a missing or different printed question identity.');
      const rawOptions = Array.isArray(raw.options) ? raw.options.map(normaliseOption).filter((option): option is string => option !== null) : [];
      const actualLabels = rawOptions.map((option) => /^\s*(?:\(([^)]+)\)|([A-Za-z0-9]+)[.)])/.exec(option)?.slice(1).find(Boolean)?.trim().toUpperCase() ?? '');
      const expectedLabels = region.options.map((option) => option.label.trim().toUpperCase());
      if (JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels)) throw errors.extractionFailed('Chemistry extraction changed the inventoried option labels, order or count.');
      raw.printed_label = region.printed_label;
      raw.question_number = questionNumberFromPrintedLabel(region.printed_label) ?? raw.question_number;
      return { raw, region, ...(molecularAudits ? { molecularAudits } : {}), chemistryIssues: [...missing, ...(chemistryIssues ?? [])] };
    });
    if (inventory.page_role === 'mixed') {
      const result = await this.call(`${companionPrompt(document, page.pageNumber, overrides)}\n\n${CHEMISTRY_ANSWER_SOURCE_RULE}`, page.png, usage, signal, answerAuditImages(page.png, document));
      return { questions, sheets: await attachChemistryAnswerSources(withSheetMolecularAudits(parseCompanionSheets(result.content, document.sectionName), result, document.id, page.pageNumber), document, page) };
    }
    return { questions, sheets: [] };
  }

  private async chemistryMetadata(raw: RawQuestion, region: ChemistryQuestionRegion, documentId: string, pageNumber: number, molecularAudits: MolecularTopologyAudit[] = [], chemistryIssues: string[] = []): Promise<ChemistryExtraction> {
    const stem = cleanString(raw.question_text);
    const options = Array.isArray(raw.options) ? raw.options.map(normaliseOption).filter((option): option is string => option !== null) : [];
    const issues: string[] = [...chemistryIssues];
    for (const audit of molecularAudits.filter((entry) => entry.status === 'unresolved')) issues.push(`${audit.candidateId}: ${audit.message}`);
    if (/\[Unresolved molecular structure:/i.test(JSON.stringify(raw))) issues.push('At least one source molecule remains unreadable; correct that individual structure or add its crop manually.');
    const visuals: ChemistryExtraction['visuals'] = [];
    const addVisual = async (field: ChemistryExtraction['visuals'][number]['field'], optionLabel: string | null, text: string, kind: 'molecule' | 'reaction' | 'figure', bbox: ChemistryQuestionRegion['bbox'], regions?: ChemistryQuestionRegion['bbox'][], moleculeCount?: number): Promise<void> => {
      const smiles = enumerateSmilesCandidates({ stem: text }).map((candidate) => candidate.smiles);
      const validation = await Promise.all(smiles.map(validateSmilesGraph));
      if (validation.some((result) => !result.ok)) issues.push(`Invalid or unsupported SMILES in ${optionLabel ? `option ${optionLabel}` : field}; correct this individual molecule before publication.`);
      visuals.push({ id: `${field}:${optionLabel ?? 'source'}`, field, optionLabel, kind, bbox: chemistryCropBox(bbox), ...(regions && regions.length > 1 ? { regions: regions.map(chemistryCropBox) } : {}), candidateSmiles: smiles, graphValid: smiles.length ? validation.every((result) => result.ok) : null, ...(moleculeCount !== undefined ? { moleculeCount } : {}), cropUrl: null, sourceDocumentId: documentId, sourcePage: pageNumber });
    };
    if (region.stem_bbox && (region.visual_kind !== 'none' || region.stem_regions.length > 1 || enumerateSmilesCandidates({ stem }).length > 0)) {
      await addVisual('stem', null, stem, region.visual_kind === 'none' ? 'figure' : region.visual_kind, region.stem_bbox, chemistryStemRegions(region), region.molecule_count);
    }
    for (const [index, option] of region.options.entries()) {
      const text = options[index] ?? '';
      if (option.visual_kind !== 'none' || enumerateSmilesCandidates({ stem: text }).length > 0) {
        await addVisual('option', option.label, text, option.visual_kind === 'none' ? 'molecule' : option.visual_kind, option.bbox, undefined, option.molecule_count);
      }
    }
    const answer = cleanStringOrNull(raw.answer);
    const explanation = cleanStringOrNull(raw.explanation);
    for (const [field, text] of [['answer', answer], ['explanation', explanation]] as const) {
      if (text && enumerateSmilesCandidates({ stem: text }).length > 0) await addVisual(field, null, text, 'reaction', region.bbox, chemistryQuestionRegions(region));
    }
    return { version: 1, representation: 'transcription', status: 'needs_review', issues: [...new Set(issues)], candidateStem: stem, candidateOptions: options, ...(answer ? { candidateAnswer: answer } : {}), ...(explanation ? { candidateExplanation: explanation } : {}), molecularAudits: molecularAudits.map((audit) => ({ ...audit, sourceDocumentId: documentId, sourcePage: pageNumber })), visuals };
  }

  private accumulateUsage(usage: AiTokenUsage, reported: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined): void {
    usage.promptTokens += reported?.prompt_tokens ?? 0;
    usage.completionTokens += reported?.completion_tokens ?? 0;
    usage.totalTokens += reported?.total_tokens ?? 0;
    usage.callCount += 1;
  }

  async extractAnswers(input: {
    pages: PageImage[];
    document: Document;
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction> {
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      const localKey = input.scope?.questionType === 'single_correct' ? nativeChoiceSheet(page.nativeChoiceKeys, input.scope.expectedPrintedLabels, input.scope.sectionName) : null;
      if (localKey) {
        sheets.push(localKey);
        continue;
      }
      // A sibling answer PDF's page numbers and document-level fallback type are unrelated to the
      // question PDF once a chapter contains several leaves. A bound scope therefore wins over the
      // sibling document when selecting the answer grammar and fallback section name.
      const prompt = answerSourcePrompt(answerPrompt(input.document, page.pageNumber, overrides, input.scope), input.document, input.scope?.subject);
      const result = await this.call(prompt, page.png, usage, input.signal, answerAuditImages(page.png, input.document, input.scope?.subject));
      sheets.push(...await attachChemistryAnswerSources(withSheetMolecularAudits(parseAnswerSheets(result.content, input.scope?.sectionName ?? input.document.sectionName), result, input.document.id, page.pageNumber), input.document, page));
    }
    return { sheets, usage };
  }

  async extractSolutions(input: {
    pages: PageImage[];
    document: Document;
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction> {
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      const prompt = answerSourcePrompt(solutionPrompt(input.document, page.pageNumber, overrides, input.scope), input.document, input.scope?.subject);
      const result = await this.call(prompt, page.png, usage, input.signal, answerAuditImages(page.png, input.document, input.scope?.subject));
      sheets.push(...await attachChemistryAnswerSources(withSheetMolecularAudits(parseSolutionSheets(result.content, input.scope?.sectionName ?? input.document.sectionName), result, input.document.id, page.pageNumber), input.document, page));
    }
    return { sheets, usage };
  }

  async extractCompanion(input: {
    pages: PageImage[];
    document: Document;
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction> {
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      const prompt = answerSourcePrompt(companionPrompt(input.document, page.pageNumber, overrides, input.scope), input.document, input.scope?.subject);
      const result = await this.call(prompt, page.png, usage, input.signal, answerAuditImages(page.png, input.document, input.scope?.subject));
      sheets.push(...await attachChemistryAnswerSources(withSheetMolecularAudits(parseCompanionSheets(result.content, input.scope?.sectionName ?? input.document.sectionName), result, input.document.id, page.pageNumber), input.document, page));
    }
    return { sheets, usage };
  }

  /**
   * Read one page's questions, retrying once if the first reply parses to zero. A page that returns no
   * questions is the clearest "possible skip" — a single retry recovers a transient, misshaped reply
   * before we accept the page as genuinely blank (a real blank page simply returns zero again, logged
   * for visibility). {@link call} already handles truncation/empty replies, so this only guards the
   * "parsed fine, but no questions" case that used to drop a whole page silently.
   */
  private async readPageQuestions(
    prompt: string,
    page: PageImage,
    document: Document,
    usage: AiTokenUsage,
    signal?: AbortSignal,
  ): Promise<RawQuestion[]> {
    const first = parseQuestions((await this.call(prompt, page.png, usage, signal)).content);
    if (first.length > 0) return first;
    const retry = parseQuestions((await this.call(prompt, page.png, usage, signal)).content);
    if (retry.length === 0) {
      logger.warn(
        { documentId: document.id, page: page.pageNumber },
        'Page yielded no questions after a retry — treating it as blank',
      );
    }
    return retry;
  }

  private emptyUsage(): AiTokenUsage {
    return {
      model: this.model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
  }

  /**
   * One vision call for one page. Folds every attempt's token usage into `usage` (mutated across the
   * page loop) so a retry is billed honestly. `signal` (when present) aborts the request the instant
   * the run is cancelled or its deadline fires.
   *
   * Guards truncation the way the sibling re-extractor and detector do. A reasoning model can spend
   * its whole output budget on hidden reasoning and return a truncated (or empty) reply, and the
   * parsers here turn unparseable JSON into an empty array — so without this guard a truncated page
   * persisted as "no questions on this page", silently, with the job still green. Retry once at
   * double the budget, then throw: a failed job names the document, an empty one hides it.
   */
  private async call(
    prompt: string,
    png: Buffer,
    usage: AiTokenUsage,
    signal?: AbortSignal,
    auditImages?: AuditImages,
  ): Promise<MolecularCallResult> {
    const imageUrl = `data:image/png;base64,${png.toString('base64')}`;
    let content = '';
    let maxCompletionTokens = MAX_TOKENS;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          // `max_completion_tokens` (not `max_tokens`) and default temperature so the same code runs on
          // gpt-4o and on the newer reasoning models (e.g. gpt-5.4-mini), which reject `max_tokens` and
          // any non-default temperature — see the sibling diagram detector.
          max_completion_tokens: maxCompletionTokens,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              ],
            },
          ],
        },
        signal ? { signal } : undefined,
      );
      usage.promptTokens += response.usage?.prompt_tokens ?? 0;
      usage.completionTokens += response.usage?.completion_tokens ?? 0;
      usage.totalTokens += response.usage?.total_tokens ?? 0;
      usage.callCount += 1;
      await this.onModelReceipt?.({ phase: 'transcription', content: response.choices[0]?.message.content ?? '', usage: { ...usage } });

      const choice = response.choices[0];
      content = choice?.message.content?.trim() ?? '';
      const truncated = choice?.finish_reason === 'length';
      if (!truncated && content) break;

      logger.warn(
        {
          model: this.model,
          attempt,
          maxCompletionTokens,
          finishReason: choice?.finish_reason,
          empty: content.length === 0,
        },
        'Extraction reply truncated or empty — retrying at a larger token budget',
      );
      if (attempt === 2) {
        throw errors.extractionFailed(
          `The model returned ${truncated ? 'a truncated' : 'an empty'} reply for a page, even at ${String(maxCompletionTokens)} tokens. The page is likely too dense — split it, or raise the extractor's token budget.`,
        );
      }
      maxCompletionTokens *= 2;
    }

    if (auditImages?.skipAudit) return { content };
    const result = await this.auditMolecularContent(content, png, usage, signal, auditImages);
    if (!auditImages?.requireAnswerCoverage || !result.sourceCounts?.length) return result;
    let primary: unknown;
    try { primary = JSON.parse(content); } catch { return result; }
    const candidates = enumerateSmilesCandidates(primary);
    const missing = result.sourceCounts.filter((source) => source.moleculeCount !== candidates.filter((entry) => entry.fieldPath === source.fieldPath).length);
    if (missing.length === 0) return result;
    const retry = await this.call(`${prompt}\n\nINCOMPLETE MOLECULAR TRANSCRIPTION: an independent source read found missing or merged molecular structures in these exact answer/solution fields: ${JSON.stringify(missing)}. Re-read those drawings and return the COMPLETE same section/printed-question ledger, without changing its entry identities, order, map names, or any other readable field. Transcribe every readable molecule in its original position as SMILES; retain all prose, arrows and conditions. Do not infer a product, erase an entry, add source-diagram placeholders or replace a whole entry with a crop. Keep answer_visual_kind/explanation_visual_kind and complete source regions for every drawn field.`, png, usage, signal, { ...auditImages, skipAudit: true });
    let retryValue: unknown;
    try { retryValue = JSON.parse(retry.content); } catch { return { ...result, chemistryIssues: [...(result.chemistryIssues ?? []), 'The completeness retry was not valid JSON; the initial answer/solution extraction remains for review.'] }; }
    if (JSON.stringify(answerSourceOwnership(primary)) !== JSON.stringify(answerSourceOwnership(retryValue))) {
      return { ...result, chemistryIssues: [...(result.chemistryIssues ?? []), 'The completeness retry changed printed answer/solution ownership; the initial extraction remains for review.'] };
    }
    const recovered = await this.auditMolecularContent(retry.content, png, usage, signal, { ...auditImages, expectedAnswerCounts: result.sourceCounts });
    const counts = new Map((recovered.sourceCounts ?? []).map((source) => [source.fieldPath, source.moleculeCount]));
    for (const source of result.sourceCounts) counts.set(source.fieldPath, Math.max(counts.get(source.fieldPath) ?? 0, source.moleculeCount));
    return { ...recovered, sourceCounts: [...counts].map(([fieldPath, moleculeCount]) => ({ fieldPath, moleculeCount })) };
  }

  private async auditMolecularContent(content: string, png: Buffer, usage: AiTokenUsage, signal?: AbortSignal, auditImages?: AuditImages): Promise<MolecularCallResult> {
    let candidate: unknown;
    try { candidate = JSON.parse(content); } catch { return { content }; }
    const candidates = enumerateSmilesCandidates(candidate);
    const declared = auditImages?.requireAnswerCoverage ? declaredMolecularSourceFields(candidate) : [];
    const expected = (auditImages?.expectedAnswerCounts ?? []).map(({ fieldPath }) => {
      const fieldText = molecularTextAtPointer(candidate, fieldPath);
      return { fieldPath, fieldText, moleculeCount: enumerateSmilesCandidates({ stem: fieldText }).length };
    });
    if (candidates.length === 0 && !auditImages?.requireCoverage && declared.length === 0 && expected.length === 0) return { content };
    const images: Buffer[] = [];
    const sourceImageForField = (fieldPath: string): string => {
      const option = /\/options\/(\d+)(?:\/|$)/.exec(fieldPath);
      const sourceImage = option ? (auditImages?.options[Number(option[1])] ?? png)
        : /\/(?:question_text|stem)(?:\/|$)/.test(fieldPath) ? (auditImages?.stem ?? png) : png;
      let imageIndex = images.indexOf(sourceImage);
      if (imageIndex === -1) { imageIndex = images.length; images.push(sourceImage); }
      return `source-${String(imageIndex)}`;
    };
    const { scopes, candidateLedger, sourceScopes } = prepareSourceTopologyAudit(candidate, sourceImageForField, (fieldPath) => Boolean(auditImages?.requireCoverage) && /\/questions\/0\/(?:question_text|options)(?:\/|$)/.test(fieldPath), [...declared, ...expected]);
    const unresolved = (message: string): MolecularCallResult => ({ content, chemistryIssues: [message], molecularAudits: candidates.map((entry) => ({ candidateId: entry.id, fieldPath: entry.fieldPath, status: 'unresolved', message })) });
    try {
      const audit = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: MAX_TOKENS,
        response_format: CHEMISTRY_TOPOLOGY_RESPONSE_FORMAT,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `${CHEMISTRY_TOPOLOGY_AUDIT_PROMPT}\nCANDIDATE OWNERSHIP:\n${JSON.stringify(candidateLedger)}\nSOURCE SCOPES:\n${JSON.stringify(sourceScopes)}` },
          ...images.flatMap((source, index): OpenAI.ChatCompletionContentPart[] => [
            { type: 'text', text: `Source image source-${String(index)}:` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${source.toString('base64')}`, detail: 'high' } },
          ]),
        ] }],
      }, signal ? { signal } : undefined);
      this.accumulateUsage(usage, audit.usage);
      await this.onModelReceipt?.({ phase: 'audit', content: audit.choices[0]?.message.content ?? '', usage: { ...usage } });
      if (audit.choices[0]?.finish_reason !== 'length') {
        const audited: unknown = JSON.parse(audit.choices[0]?.message.content ?? '');
        const result = await applySourceTopologyAudit(candidate, audited, scopes);
        if (result.diagnostics.length) logger.warn({ diagnostics: result.diagnostics.map((entry) => entry.code) }, 'Independent chemistry topology has unresolved evidence; retaining those molecular slots for review');
        return { content: JSON.stringify(result.value), molecularAudits: result.audits, chemistryIssues: result.diagnostics.map((entry) => entry.message), ...(result.sourceCounts ? { sourceCounts: result.sourceCounts } : {}) };
      }
      return unresolved('Independent atom/bond transcription was truncated; the original molecular candidates require review.');
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn({ err: error }, 'Chemistry audit failed; preserving original extraction');
      return unresolved('Independent atom/bond transcription did not complete; the original molecular candidates require review.');
    }
  }
}
