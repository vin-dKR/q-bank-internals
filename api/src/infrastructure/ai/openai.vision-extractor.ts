import { OpenAI } from 'openai';
import type { Document } from '@ingest/contracts';
import type {
  AnswerExtraction,
  AnswerSheet,
  ExtractedQuestion,
  PageImage,
  QuestionExtraction,
  VisionExtractor,
} from '../../modules/extraction/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { logger } from '../../shared/logger/logger.js';
import { answerPrompt, questionPrompt, solutionPrompt } from './prompts/extraction-prompts.js';

/** Shape the question prompt asks the model to return, before we enrich with section/page. */
type RawQuestion = {
  question_number?: unknown;
  question_text?: unknown;
  options?: unknown;
  /** Only present for comprehension questions — the shared passage, repeated on each sub-question. */
  passage?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
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

/** Non-empty string, or null — used to keep blank answers/explanations as an explicit absence. */
function asStringOrNull(value: unknown): string | null {
  const text = asString(value).trim();
  return text.length > 0 ? text : null;
}

/** Parse an answer-sheet response: `answers` is a flat number→letter/value map (no explanation). */
function parseAnswerSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; answers?: unknown };
      const entries: AnswerSheet['entries'] = {};
      if (record.answers && typeof record.answers === 'object') {
        for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
          entries[key] = { answer: asStringOrNull(value), explanation: null };
        }
      }
      return { sectionName: asString(record.section_name) || fallbackSection, entries };
    });
  } catch {
    return [];
  }
}

/** Parse a solution response: `solutions` is a number→{ answer, explanation } map. */
function parseSolutionSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; solutions?: unknown };
      const entries: AnswerSheet['entries'] = {};
      if (record.solutions && typeof record.solutions === 'object') {
        for (const [key, value] of Object.entries(record.solutions as Record<string, unknown>)) {
          const entry = (value ?? {}) as { answer?: unknown; explanation?: unknown };
          entries[key] = {
            answer: asStringOrNull(entry.answer),
            explanation: asStringOrNull(entry.explanation),
          };
        }
      }
      return { sectionName: asString(record.section_name) || fallbackSection, entries };
    });
  } catch {
    return [];
  }
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
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extractQuestions(input: {
    pages: PageImage[];
    document: Document;
  }): Promise<QuestionExtraction> {
    const results: ExtractedQuestion[] = [];
    const usage = this.emptyUsage();
    for (const page of input.pages) {
      // Per page: the topic config can bind different pages to different fixed question types.
      const prompt = questionPrompt(input.document, page.pageNumber);
      const { content } = await this.call(prompt, page.png, usage);
      for (const raw of parseQuestions(content)) {
        results.push({
          questionNumber: toQuestionNumber(raw.question_number),
          questionText: asString(raw.question_text),
          options: Array.isArray(raw.options) ? raw.options.map(asString).filter(Boolean) : [],
          answer: null,
          explanation: null,
          sectionName: input.document.sectionName,
          questionType: input.document.questionType,
          sourcePage: page.pageNumber,
          passage: asStringOrNull(raw.passage),
        });
      }
    }
    logger.info(
      { documentId: input.document.id, model: this.model, pages: input.pages.length, questions: results.length },
      'question extraction done',
    );
    return { questions: results, usage };
  }

  async extractAnswers(input: { pages: PageImage[]; document: Document }): Promise<AnswerExtraction> {
    const prompt = answerPrompt(input.document);
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    for (const page of input.pages) {
      const { content } = await this.call(prompt, page.png, usage);
      sheets.push(...parseAnswerSheets(content, input.document.sectionName));
    }
    return { sheets, usage };
  }

  async extractSolutions(input: {
    pages: PageImage[];
    document: Document;
  }): Promise<AnswerExtraction> {
    const prompt = solutionPrompt(input.document);
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    for (const page of input.pages) {
      const { content } = await this.call(prompt, page.png, usage);
      sheets.push(...parseSolutionSheets(content, input.document.sectionName));
    }
    return { sheets, usage };
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

  /** One vision call. Folds the response's token usage into `usage` (mutated across the page loop). */
  private async call(prompt: string, png: Buffer, usage: AiTokenUsage): Promise<{ content: string }> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      // `max_completion_tokens` (not `max_tokens`) and default temperature so the same code runs on
      // gpt-4o and on the newer reasoning models (e.g. gpt-5.4-mini), which reject `max_tokens` and any
      // non-default temperature — see the sibling diagram detector. Kept generous because a reasoning
      // model spends part of this budget on hidden reasoning before the question JSON.
      max_completion_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${png.toString('base64')}`, detail: 'high' },
            },
          ],
        },
      ],
    });
    usage.promptTokens += response.usage?.prompt_tokens ?? 0;
    usage.completionTokens += response.usage?.completion_tokens ?? 0;
    usage.totalTokens += response.usage?.total_tokens ?? 0;
    usage.callCount += 1;
    return { content: response.choices[0]?.message.content ?? '{}' };
  }
}
