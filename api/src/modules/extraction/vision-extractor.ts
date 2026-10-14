import type { ChemistryExtraction, Document, ImageCrop, MatchData, PageRange } from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';
import type { SourcePageLayout } from './source-page-layout.js';

/** One rasterized PDF page handed to the vision model. */
export type PageImage = { pageNumber: number; png: Buffer; layout?: SourcePageLayout | null; nativeChoiceKeys?: Record<string, string> | null };

/** One masters dictionary row as presented to the model (its id, display name, canonical key + kind). */
export type MasterOption = { id: string; name: string; key: string; kind: string | null };

/**
 * A live snapshot of the closed masters dimensions the model classifies into, injected into the
 * extraction prompt so the AI chooses ONLY from the operator-managed vocabulary (never invents one) and
 * a rename/edit of a master is reflected without a code change. Fetched once per run by the worker.
 */
export type MastersSnapshot = { questionType: MasterOption[]; level: MasterOption[] };

/**
 * A question draft as the vision model returns it — deliberately close to the Python extractor's
 * per-question shape (`question_number` / `question_text` / `options`) so the ported prompts and
 * parsing stay faithful. `answer` is filled in later, during the answer merge.
 */
export type ExtractedQuestion = {
  imageCrops?: ImageCrop[];
  questionNumber: number | null;
  /** Exact printed question identity, including an exercise prefix; absent on older draft runs. */
  printedLabel?: string | null;
  chemistry?: ChemistryExtraction | null;
  /** Normalized source question bounds, in the persisted SourceRegion bbox convention. */
  sourceBbox?: [number, number, number, number];
  questionText: string;
  options: string[];
  answer: string | null;
  explanation: string | null;
  sectionName: string | null;
  // The model's own classification of this question's type (one of KNOWN_QUESTION_TYPES), or null when
  // it returned nothing usable. `toNewQuestion` prefers it and falls back to the operator's binding.
  questionType: string | null;
  // The model's difficulty classification (easy|medium|hard), or null. Stamped onto the persisted
  // question and resolved to the bank's Level FK on publish.
  level: string | null;
  /** The model's 0–1 confidence in its difficulty classification; null for legacy/custom prompt replies. */
  difficultyConfidence: number | null;
  sourcePage: number;
  /**
   * The SOURCE exam + year the model read off the page for a PYQ segment (e.g. "NEET" / "2019"), or
   * null when the segment is not PYQ or the page did not print them. Distinct from the target
   * exam/subject; stamped onto the persisted question by {@link toNewQuestion}.
   */
  pyqExam: string | null;
  pyqYear: string | null;
  /**
   * Structured match-the-column data (columns + best-effort key) when the model read this as a MATRIX
   * MATCH question; null otherwise. When set, {@link toNewQuestion} persists it and mirrors the key
   * into the flat `answer` — the stem stays the bare instruction and `options` stays empty.
   */
  match: MatchData | null;
  /**
   * The shared comprehension passage this draft belongs under, returned by the vision model VERBATIM
   * and identical across every sub-question of the same passage — null for ordinary questions. It is
   * the grouping SIGNAL: {@link materializePassages} dedups the drafts that share a passage into ONE
   * passage row and stamps each with that row's {@link passageId} + a sequential {@link groupOrder}.
   * The passage TEXT then lives once on the passage row, never copied onto the question row.
   */
  passage: string | null;
  /**
   * The passage row's stable id (BLA-125 v2), assigned by {@link materializePassages}: shared by every
   * sub-question of one comprehension group, null until grouping runs and on every non-comprehension
   * draft. Persisted as the question's `passageId` so a group-aware renderer + whole-group re-extraction
   * can resolve the group.
   */
  passageId: string | null;
  /** This sub-question's 0-based position within its comprehension group; null off a group. */
  groupOrder: number | null;
};

/** Where an answer value came from, used to preserve an explicit answer key over a solution restatement. */
export type AnswerSource = 'answer_key' | 'solution' | 'unknown';

/**
 * One question's key material as read from an answer/solution sheet: the answer letter/text and/or
 * the worked-solution explanation. Either may be absent — an answer PDF supplies only `answer`, a
 * solution PDF supplies `explanation` (and often the final `answer` too). `answerSource` is internal
 * merge provenance: an explicit answer key is canonical when it disagrees with a final answer repeated
 * by a worked solution.
 */
export type AnswerEntry = {
  answer: string | null;
  explanation: string | null;
  answerSource?: AnswerSource;
  /** Equal-priority sources disagree, so this entry must not supply an automatically chosen answer. */
  answerConflict?: boolean;
  /** Full numbered source blocks, in normalized left/top/right/bottom coordinates. */
  sourceRegions?: Array<[number, number, number, number]>;
  sourceVisualKinds?: Partial<Record<'answer' | 'explanation', 'molecule' | 'reaction' | 'figure'>>;
  /** Drawn species counted independently, including fields whose primary SMILES were omitted. */
  sourceMoleculeCounts?: ChemistryExtraction['sourceMoleculeCounts'];
  chemistryVisuals?: ChemistryExtraction['visuals'];
  chemistryIssues?: string[];
  molecularAudits?: NonNullable<ChemistryExtraction['molecularAudits']>;
  unresolvedSourceFields?: Array<'answer' | 'explanation'>;
  imageCrops?: ImageCrop[];
};

function hasAnswer(entry: AnswerEntry): boolean {
  return entry.answer !== null && entry.answer.trim() !== '';
}

function answerSourceRank(source: AnswerSource | undefined): number {
  switch (source) {
    case 'answer_key': return 2;
    case 'solution': return 1;
    default: return 0;
  }
}

/**
 * Combine repeated page fragments for one question. An answer key is authoritative over a worked
 * solution's final-answer restatement, while a solution always contributes any non-duplicate working.
 * Equal-priority sources that disagree leave the answer unresolved. A later source at that same
 * priority cannot erase the conflict; only a higher-priority answer key can resolve a solution conflict.
 */
export function mergeAnswerEntries(
  existing: AnswerEntry | undefined,
  incoming: AnswerEntry,
): AnswerEntry {
  if (!existing) return incoming;
  const existingRank = answerSourceRank(existing.answerSource);
  const incomingRank = answerSourceRank(incoming.answerSource);
  const chosen = existing.answerConflict && (existingRank >= incomingRank || !hasAnswer(incoming))
    ? existing
    : incoming.answerConflict && incomingRank >= existingRank
      ? incoming
      : !hasAnswer(existing)
    ? incoming
    : !hasAnswer(incoming)
      ? existing
      : incomingRank > existingRank
        ? incoming
        : existing;
  const answerConflict = chosen.answerConflict === true || (
    hasAnswer(existing) && hasAnswer(incoming) && existingRank === incomingRank &&
    existing.answer?.trim().toUpperCase() !== incoming.answer?.trim().toUpperCase()
  );
  const prior = existing.explanation?.trim() ?? '';
  const next = incoming.explanation?.trim() ?? '';
  const explanation = !prior
    ? (next || null)
    : !next || prior === next || prior.includes(next)
      ? prior
      : next.includes(prior)
        ? next
        : `${prior}\n\n${next}`;
  // Metadata must follow the explanation fragment that survives prose deduplication. Keeping both
  // source ledgers for a repeated or superseded block would count every drawn molecule twice.
  const explanationSources = !prior
    ? !next && (existing.chemistryVisuals?.some((visual) => visual.field === 'explanation') || existing.unresolvedSourceFields?.includes('explanation'))
      ? [existing]
      : [incoming]
    : !next || prior === next || prior.includes(next)
      ? [existing]
      : next.includes(prior)
        ? [incoming]
        : [existing, incoming];
  const answerVisuals = chosen.chemistryVisuals?.filter((visual) => visual.field === 'answer') ?? [];
  const explanationVisuals = explanationSources.flatMap((entry) => entry.chemistryVisuals?.filter((visual) => visual.field === 'explanation') ?? []);
  const chemistryVisuals = [...new Map([...answerVisuals, ...explanationVisuals].map((visual) => [visual.id, visual])).values()];
  const sourceRegions = [...new Map([...(existing.sourceRegions ?? []), ...(incoming.sourceRegions ?? [])].map((box) => [box.join(':'), box])).values()];
  const chemistryIssues = [...new Set([...(existing.chemistryIssues ?? []), ...(incoming.chemistryIssues ?? [])])];
  const molecularAudits = [
    ...(chosen.molecularAudits?.filter((audit) => audit.fieldPath.endsWith('/answer')) ?? []),
    ...explanationSources.flatMap((entry) => entry.molecularAudits?.filter((audit) => !audit.fieldPath.endsWith('/answer')) ?? []),
  ];
  const selectedUrls = new Set(chemistryVisuals.flatMap((visual) => visual.cropUrl ? [visual.cropUrl] : []));
  const imageCrops = [...(existing.imageCrops ?? []), ...(incoming.imageCrops ?? [])].filter((crop) => selectedUrls.has(crop.url));
  const explanationKind = [...explanationSources].reverse().find((entry) => entry.sourceVisualKinds?.explanation)?.sourceVisualKinds?.explanation;
  const explanationCounts = explanationSources.flatMap((entry) => entry.sourceMoleculeCounts?.explanation !== undefined ? [entry.sourceMoleculeCounts.explanation] : []);
  const overlappingCounts = [existing, incoming].flatMap((entry) => entry.sourceMoleculeCounts?.explanation !== undefined ? [entry.sourceMoleculeCounts.explanation] : []);
  const explanationCount = prior && next && (prior === next || prior.includes(next) || next.includes(prior)) && overlappingCounts.length
    ? Math.max(...overlappingCounts)
    : explanationCounts.length ? explanationCounts.reduce((sum, count) => sum + count, 0) : undefined;
  const sourceMoleculeCounts = {
    ...(chosen.sourceMoleculeCounts?.answer !== undefined ? { answer: chosen.sourceMoleculeCounts.answer } : {}),
    ...(explanationCount !== undefined ? { explanation: explanationCount } : {}),
  };
  const unresolvedSourceFields = [...new Set([
    ...(chosen.unresolvedSourceFields?.filter((field) => field === 'answer') ?? []),
    ...explanationSources.flatMap((entry) => entry.unresolvedSourceFields?.filter((field) => field === 'explanation') ?? []),
  ])];
  const sourceVisualKinds = {
    ...(chosen.sourceVisualKinds?.answer ? { answer: chosen.sourceVisualKinds.answer } : {}),
    ...(explanationKind ? { explanation: explanationKind } : {}),
  };
  return {
    answer: !answerConflict && hasAnswer(chosen) ? chosen.answer : null,
    explanation,
    ...(chosen.answerSource ? { answerSource: chosen.answerSource } : {}),
    ...(answerConflict ? { answerConflict: true } : {}),
    ...(sourceRegions.length ? { sourceRegions } : {}),
    ...(chemistryVisuals.length ? { chemistryVisuals } : {}),
    ...(chemistryIssues.length ? { chemistryIssues } : {}),
    ...(molecularAudits.length ? { molecularAudits } : {}),
    ...(imageCrops.length ? { imageCrops } : {}),
    ...(Object.keys(sourceVisualKinds).length ? { sourceVisualKinds } : {}),
    ...(Object.keys(sourceMoleculeCounts).length ? { sourceMoleculeCounts } : {}),
    ...(unresolvedSourceFields.length ? { unresolvedSourceFields } : {}),
  };
}

/** An answer/solution key for one section: question-number (as string) → its {@link AnswerEntry}. */
export type AnswerSheet = { sectionName: string | null; entries: Record<string, AnswerEntry> };

/**
 * The question-PDF leaf an answer/solution page range belongs to. Sibling answer and solution
 * documents deliberately do not carry the question document's topic map, so their own document-level
 * type is not a safe prompt hint for an assembled, mixed-type upload. The worker supplies this scope
 * for each bound range and the AI adapter uses it for both prompt routing and an unambiguous fallback
 * section name.
 */
export type AnswerExtractionScope = {
  /** Exact source identities requested by the owning question block; enables safe local key reading. */
  expectedPrintedLabels?: string[];
  /** Stable topic/leaf key used by {@link mergeAnswers}; not merely a display heading. */
  sectionName: string;
  /** The exact type fixed on the corresponding question leaf; null means mixed/unknown. */
  questionType: string | null;
  /** The leaf's subject, which can be more precise than the sibling PDF's document-level metadata. */
  subject?: string;
  /** The leaf's inclusive page span in the question PDF. */
  questionPageRange: PageRange;
  /** The inclusive page span selected from this answer or solution PDF. */
  sourcePageRange: PageRange;
};

/** Extraction results paired with the token spend the model reported producing them. */
export type QuestionExtraction = { questions: ExtractedQuestion[]; usage: AiTokenUsage; sheets?: AnswerSheet[] };
export type AnswerExtraction = { sheets: AnswerSheet[]; usage: AiTokenUsage };

/**
 * The vision-extraction PORT (§3), owned by the extraction module. Implemented in
 * `infrastructure/ai` with an OpenAI vision model (`EXTRACTION_MODEL`, ported from the Python PDF
 * Extractor), plus a null-object adapter used when no API key is configured. Runs in the worker,
 * never the API. Each method returns the model's token {@link AiTokenUsage} so the worker can
 * record spend.
 */
/** Live progress of a page-by-page extraction, reported after each page completes. */
export type ExtractionProgress = { pagesTotal: number; pagesDone: number; questionsFound: number };

export interface VisionExtractor {
  /**
   * Extract question drafts from a document's rasterized question pages. `signal` aborts the in-flight
   * vision call on cancel/timeout; `onProgress` fires after each page so the worker can persist live
   * progress (pages done + questions so far).
   */
  extractQuestions(input: {
    pages: PageImage[];
    document: Document;
    signal?: AbortSignal;
    onProgress?: (progress: ExtractionProgress) => Promise<void>;
  }): Promise<QuestionExtraction>;
  /** Extract answer keys (letters/values only) from a document's rasterized answer-sheet pages. */
  extractAnswers(input: {
    pages: PageImage[];
    document: Document;
    /** Present for v2 bound ranges; absent for legacy whole-answer-PDF extraction. */
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction>;
  /** Extract worked-solution explanations (and any final answer) from a solution PDF's pages. */
  extractSolutions(input: {
    pages: PageImage[];
    document: Document;
    /** Present for v2 bound ranges; absent for legacy whole-solution-PDF extraction. */
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction>;
  /** Extract a single grouped Answer + Solution companion PDF into answer + explanation entries. */
  extractCompanion(input: {
    pages: PageImage[];
    document: Document;
    /** Present for v2 combined-layout topic ranges. */
    scope?: AnswerExtractionScope;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction>;
}
