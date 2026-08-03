import OpenAI from 'openai';
import type { Document } from '@ingest/contracts';
import type {
  AnswerSheet,
  ExtractedQuestion,
  PageImage,
  VisionExtractor,
} from '../../modules/extraction/index.js';
import { logger } from '../../shared/logger/logger.js';
import { answerPrompt, questionPrompt } from './prompts/extraction-prompts.js';

/** Shape the question prompt asks the model to return, before we enrich with section/page. */
type RawQuestion = { question_number?: unknown; question_text?: unknown; options?: unknown };

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

function parseAnswerSheets(content: string, fallbackSection: string | null): AnswerSheet[] {
  try {
    const parsed: unknown = JSON.parse(content);
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return [];
    return sections.map((section) => {
      const record = section as { section_name?: unknown; answers?: unknown };
      const answers: Record<string, string> = {};
      if (record.answers && typeof record.answers === 'object') {
        for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
          answers[key] = asString(value);
        }
      }
      return { sectionName: asString(record.section_name) || fallbackSection, answers };
    });
  } catch {
    return [];
  }
}

/**
 * {@link VisionExtractor} backed by OpenAI `gpt-4o` vision — the TypeScript port of the Python
 * extractor's OpenAI service. One image per call (serial, like the Python default) for reliable JSON,
 * `response_format: json_object`, low temperature. Runs in the worker, never the API request path.
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
  }): Promise<ExtractedQuestion[]> {
    const prompt = questionPrompt(input.document);
    const results: ExtractedQuestion[] = [];
    for (const page of input.pages) {
      const content = await this.call(prompt, page.png);
      for (const raw of parseQuestions(content)) {
        results.push({
          questionNumber: toQuestionNumber(raw.question_number),
          questionText: asString(raw.question_text),
          options: Array.isArray(raw.options) ? raw.options.map(asString).filter(Boolean) : [],
          answer: null,
          sectionName: input.document.sectionName,
          questionType: input.document.questionType,
          sourcePage: page.pageNumber,
        });
      }
    }
    logger.info(
      { documentId: input.document.id, pages: input.pages.length, questions: results.length },
      'gpt-4o question extraction done',
    );
    return results;
  }

  async extractAnswers(input: { pages: PageImage[]; document: Document }): Promise<AnswerSheet[]> {
    const prompt = answerPrompt(input.document);
    const sheets: AnswerSheet[] = [];
    for (const page of input.pages) {
      const content = await this.call(prompt, page.png);
      sheets.push(...parseAnswerSheets(content, input.document.sectionName));
    }
    return sheets;
  }

  private async call(prompt: string, png: Buffer): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 4000,
      temperature: 0.1,
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
    return response.choices[0]?.message.content ?? '{}';
  }
}
