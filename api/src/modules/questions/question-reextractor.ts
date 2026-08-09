import type { QuestionOption } from '@ingest/contracts';
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
  usage: AiTokenUsage;
};

/**
 * PORT (§3) for "re-extract this question from its page": re-read one already-extracted question's
 * source page and return its fields afresh (stem, options, answer, explanation). The companion to
 * {@link LatexRefiner} — where refine only cleans given text, this re-reads the page image.
 * Implemented with an OpenAI vision model in `infrastructure/ai`, with a null-object when no API key
 * is configured. Returns the model's {@link AiTokenUsage} so the service records spend like the rest.
 */
export interface QuestionReExtractor {
  reExtract(input: ReExtractInput): Promise<QuestionReExtraction>;
}
