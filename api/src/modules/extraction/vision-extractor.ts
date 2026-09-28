import type { Document, MatchData, PageRange } from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';

/** One rasterized PDF page handed to the vision model. */
export type PageImage = { pageNumber: number; png: Buffer };

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
  questionNumber: number | null;
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
 * Equal-priority sources retain their first value in PDF order rather than letting a later OCR pass
 * silently flip it.
 */
export function mergeAnswerEntries(
  existing: AnswerEntry | undefined,
  incoming: AnswerEntry,
): AnswerEntry {
  if (!existing) return incoming;
  const chosen = !hasAnswer(existing)
    ? incoming
    : !hasAnswer(incoming)
      ? existing
      : answerSourceRank(incoming.answerSource) > answerSourceRank(existing.answerSource)
        ? incoming
        : existing;
  const prior = existing.explanation?.trim() ?? '';
  const next = incoming.explanation?.trim() ?? '';
  const explanation = !prior
    ? (next || null)
    : !next || prior === next || prior.includes(next)
      ? prior
      : next.includes(prior)
        ? next
        : `${prior}\n\n${next}`;
  return {
    answer: hasAnswer(chosen) ? chosen.answer : null,
    explanation,
    ...(chosen.answerSource ? { answerSource: chosen.answerSource } : {}),
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
export type QuestionExtraction = { questions: ExtractedQuestion[]; usage: AiTokenUsage };
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
