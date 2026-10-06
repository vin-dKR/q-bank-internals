import type {
  MatchData,
  QuestionOption,
  ReExtractGroupMode,
  TranscribeAreaTarget,
} from '@ingest/contracts';
import type { AiTokenUsage } from '../usage/index.js';

/** Which document layout the one-question re-read is looking at. */
export type ReExtractSourceKind = 'question' | 'answer' | 'solution' | 'companion';

/** One rendered page image plus the identity of the question to re-read from it. */
export type ReExtractInput = {
  png: Buffer;
  /** The printed number of the target question — picks it out of a multi-question page. */
  questionNumber: number | null;
  /** The current stem, used as a fallback hint when the page has no readable number. */
  stemHint: string;
  /** The fixed question type, so the model extracts the right option shape. */
  questionType: string | null;
  /** A sibling Answer/Solution page needs a field-specific prompt, not a question-paper prompt. */
  sourceKind?: ReExtractSourceKind;
  /** Explicit field intent for a grouped Answer + Solution companion source. */
  fieldTarget?: 'answer' | 'solution';
  /** When a question source carries inline answers/solutions, preserve the number-to-number boundary. */
  inlineAnswers?: boolean;
};

/** A tightly cropped region selected from a source PDF for literal transcription. */
export type TranscribeRegionInput = {
  png: Buffer;
  destination: 'stem' | 'option' | 'answer' | 'solution';
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

/** One tight source-area image, selected by the operator for field-level transcription. */
export type SourceAreaTranscriptionInput = { png: Buffer; target: TranscribeAreaTarget };

/** The exact text read from a selected source area, plus the vision call's token spend. */
export type SourceAreaTranscription = { text: string; usage: AiTokenUsage };

/** One existing comprehension member, used to keep a group re-read in the right structural shape. */
export type GroupReExtractMember = {
  /** Printed number when readable; not unique enough to be the sole matching key. */
  questionNumber: number | null;
  /** Current stem gives the model a second, stable anchor when printed numbers repeat or are absent. */
  stemHint: string;
  /** The row's persisted type: a group may mix single, integer, matrix, etc. */
  questionType: string | null;
};

/** Rendered source page images plus the identity of the comprehension GROUP to re-read from them. */
export type GroupReExtractInput = {
  /** A group can continue over several question-PDF pages; images are supplied in reading order. */
  pngs: readonly Buffer[];
  /** Whether this operation may replace member-question fields as well as the shared passage. */
  mode: ReExtractGroupMode;
  /**
   * Existing member rows in their group order. Unlike one group-wide type hint, this preserves each
   * child's own schema — a comprehension can legitimately contain a matrix beside an integer question.
   */
  members: readonly GroupReExtractMember[];
  /** The first ~120 chars of the current passage, so the model reads the RIGHT passage off the page. */
  passageHint: string;
  /** Source layout for a redirected group re-read; keeps an answer/solution page out of question OCR. */
  sourceKind?: ReExtractSourceKind;
  /** Explicit field intent for a grouped companion source. */
  fieldTarget?: 'answer' | 'solution';
  /** Preserve inline question → answer boundaries when the question PDF itself carries both. */
  inlineAnswers?: boolean;
};

/** One re-extracted sub-question of a group as the model read it (before it is matched to a row). */
export type ReExtractedSubDraft = {
  /** Model-returned stable member position; null on legacy/fallback replies. */
  memberIndex: number | null;
  questionNumber: number | null;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string | null;
  match: MatchData | null;
};

/** The whole-group re-read: the shared passage, its sub-questions, and the token spend. */
export type GroupReExtraction = {
  mode: ReExtractGroupMode;
  passage: string;
  subQuestions: ReExtractedSubDraft[];
  usage: AiTokenUsage;
};

/**
 * PORT (§3) for "re-extract this question from its page": re-read one already-extracted question's
 * source page and return its fields afresh (stem, options, answer, explanation). The companion to
 * {@link LatexRefiner} — where refine only cleans given text, this re-reads the page image.
 * {@link reExtractGroup} is the comprehension counterpart: it re-reads a whole shared-passage block
 * (the passage alone or the passage plus every sub-question) in one call. Implemented with an OpenAI vision model in
 * `infrastructure/ai`, with a null-object when no API key is configured. Returns the model's
 * {@link AiTokenUsage} so the service records spend like the rest.
 */
export interface QuestionReExtractor {
  reExtract(input: ReExtractInput): Promise<QuestionReExtraction>;
  reExtractGroup(input: GroupReExtractInput): Promise<GroupReExtraction>;
  /** Read only an operator-selected source region, without re-extracting the full question/page. */
  transcribeArea(input: SourceAreaTranscriptionInput): Promise<SourceAreaTranscription>;
  /** Transcribe a field-specific crop into the question, answer, or solution. */
  transcribeRegion(input: TranscribeRegionInput): Promise<{ text: string; usage: AiTokenUsage }>;
}
