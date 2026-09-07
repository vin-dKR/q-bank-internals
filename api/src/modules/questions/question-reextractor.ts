import type { MatchData, QuestionOption } from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';

/** One rendered page image plus the identity of the question to re-read from it. */
export type ReExtractInput = {
  png: Buffer;
  /** The printed number of the target question — picks it out of a multi-question page. */
  questionNumber: number | null;
  /** The current stem, used as a fallback hint when the page has no readable number. */
  stemHint: string;
  /** The fixed question type, so the model extracts the right option shape. */
  questionType: string | null;
};

/** The re-extracted fields plus the token spend the model reported producing them. */
export type QuestionReExtraction = {
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string | null;
  /** Structured columns + matching for a MATRIX MATCH re-read; null for every other type. */
  match: MatchData | null;
  usage: AiTokenUsage;
};

/** One rendered page image plus the identity of the comprehension GROUP to re-read whole from it. */
export type GroupReExtractInput = {
  png: Buffer;
  /**
   * The printed numbers of the group's sub-questions, in order — help the model target the right block
   * and return one entry per sub-question. A null entry means that sub-question had no readable number.
   */
  questionNumbers: (number | null)[];
  /** The first ~120 chars of the current passage, so the model reads the RIGHT passage off the page. */
  passageHint: string;
  /** The fixed question type (comprehension), carried for symmetry with the single-question path. */
  questionType: string | null;
};

/** One re-extracted sub-question of a group as the model read it (before it is matched to a row). */
export type ReExtractedSubDraft = {
  questionNumber: number | null;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string | null;
  match: MatchData | null;
};

/** The whole-group re-read: the shared passage, its sub-questions, and the token spend. */
export type GroupReExtraction = {
  passage: string;
  subQuestions: ReExtractedSubDraft[];
  usage: AiTokenUsage;
};

/**
 * PORT (§3) for "re-extract this question from its page": re-read one already-extracted question's
 * source page and return its fields afresh (stem, options, answer, explanation). The companion to
 * {@link LatexRefiner} — where refine only cleans given text, this re-reads the page image.
 * {@link reExtractGroup} is the comprehension counterpart: it re-reads a whole shared-passage block
 * (the passage plus every sub-question) in one call. Implemented with an OpenAI vision model in
 * `infrastructure/ai`, with a null-object when no API key is configured. Returns the model's
 * {@link AiTokenUsage} so the service records spend like the rest.
 */
export interface QuestionReExtractor {
  reExtract(input: ReExtractInput): Promise<QuestionReExtraction>;
  reExtractGroup(input: GroupReExtractInput): Promise<GroupReExtraction>;
}
