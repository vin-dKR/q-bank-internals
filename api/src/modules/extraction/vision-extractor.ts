import type { Document, MatchData } from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';

/** One rasterized PDF page handed to the vision model. */
export type PageImage = { pageNumber: number; png: Buffer };

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
  questionType: string | null;
  sourcePage: number;
  /**
   * Structured match-the-column data (columns + best-effort key) when the model read this as a MATRIX
   * MATCH question; null otherwise. When set, {@link toNewQuestion} persists it and mirrors the key
   * into the flat `answer` — the stem stays the bare instruction and `options` stays empty.
   */
  match: MatchData | null;
  /**
   * The shared comprehension passage this draft belongs under, returned VERBATIM and identical across
   * every sub-question of the same passage — null for ordinary questions. It is the grouping key that
   * {@link mergeAnswers}'s caller uses to collapse a comprehension block into ONE combined question,
   * so the passage is stored once (never repeated per sub-question).
   */
  passage: string | null;
};

/**
 * One question's key material as read from an answer/solution sheet: the answer letter/text and/or
 * the worked-solution explanation. Either may be absent — an answer PDF supplies only `answer`, a
 * solution PDF supplies `explanation` (and often the final `answer` too).
 */
export type AnswerEntry = { answer: string | null; explanation: string | null };

/** An answer/solution key for one section: question-number (as string) → its {@link AnswerEntry}. */
export type AnswerSheet = { sectionName: string | null; entries: Record<string, AnswerEntry> };

/** Extraction results paired with the token spend the model reported producing them. */
export type QuestionExtraction = { questions: ExtractedQuestion[]; usage: AiTokenUsage };
export type AnswerExtraction = { sheets: AnswerSheet[]; usage: AiTokenUsage };

/**
 * The vision-extraction PORT (§3), owned by the extraction module. Implemented in
 * `infrastructure/ai` with OpenAI `gpt-4o` (ported from the Python PDF Extractor), plus a
 * null-object adapter used when no API key is configured. Runs in the worker, never the API.
 * Each method returns the model's token {@link AiTokenUsage} so the worker can record spend.
 */
export interface VisionExtractor {
  /** Extract question drafts from a document's rasterized question pages. */
  extractQuestions(input: { pages: PageImage[]; document: Document }): Promise<QuestionExtraction>;
  /** Extract answer keys (letters/values only) from a document's rasterized answer-sheet pages. */
  extractAnswers(input: { pages: PageImage[]; document: Document }): Promise<AnswerExtraction>;
  /** Extract worked-solution explanations (and any final answer) from a solution PDF's pages. */
  extractSolutions(input: { pages: PageImage[]; document: Document }): Promise<AnswerExtraction>;
}
