import type { Document } from '@ingest/contracts';

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
  sectionName: string | null;
  questionType: string | null;
  sourcePage: number;
};

/** An answer key for one section: question-number (as string) → answer letter/text. */
export type AnswerSheet = { sectionName: string | null; answers: Record<string, string> };

/**
 * The vision-extraction PORT (§3), owned by the extraction module. Implemented in
 * `infrastructure/ai` with OpenAI `gpt-4o` (ported from the Python PDF Extractor), plus a
 * null-object adapter used when no API key is configured. Runs in the worker, never the API.
 */
export interface VisionExtractor {
  /** Extract question drafts from a document's rasterized question pages. */
  extractQuestions(input: { pages: PageImage[]; document: Document }): Promise<ExtractedQuestion[]>;
  /** Extract answer keys from a document's rasterized answer pages. */
  extractAnswers(input: { pages: PageImage[]; document: Document }): Promise<AnswerSheet[]>;
}
