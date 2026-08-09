import { OpenAI } from 'openai';
import type { QuestionOption } from '@ingest/contracts';
import type {
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractInput,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { logger } from '../../shared/logger/logger.js';
import { reExtractQuestionPrompt } from './prompts/extraction-prompts.js';

/** Shape the re-extract prompt asks the model to return, before we normalise each field. */
type RawOption = { label?: unknown; body?: unknown; is_correct?: unknown };
type RawReExtract = { stem?: unknown; options?: unknown; answer?: unknown; explanation?: unknown };

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Non-empty trimmed string, or null — keeps a blank explanation an explicit absence. */
function asStringOrNull(value: unknown): string | null {
  const text = asString(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Parse the model's reply, tolerating the ways a vision model wraps JSON — a bare object, a ```json
 * fence, or an object with prose around it — so a stray wrapper never drops the whole re-extraction.
 */
function parseReply(content: string): RawReExtract {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidate = fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);
  try {
    return JSON.parse(candidate) as RawReExtract;
  } catch {
    return {};
  }
}

/** Normalise the raw `options` array into the contract shape, labelling by position as a fallback. */
function toOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawOption[]).map((item, index) => ({
    label: asString(item.label).trim() || String.fromCharCode(65 + index),
    body: asString(item.body).trim(),
    isCorrect: item.is_correct === true,
  }));
}

/**
 * {@link QuestionReExtractor} backed by an OpenAI vision model — one call re-reads a single question's
 * page image and returns its fields. Mirrors {@link OpenAiVisionExtractor}'s call shape
 * (`max_completion_tokens`, `response_format: json_object`) so the same code runs on gpt-4o and the
 * newer reasoning models. Runs on the API request path (interactive, one question at a time).
 */
export class OpenAiQuestionReExtractor implements QuestionReExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async reExtract(input: ReExtractInput): Promise<QuestionReExtraction> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 16000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: reExtractQuestionPrompt({
                questionNumber: input.questionNumber,
                stemHint: input.stemHint,
                questionType: input.questionType,
              }),
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${input.png.toString('base64')}`, detail: 'high' },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message.content ?? '{}';
    const parsed = parseReply(content);
    const options = toOptions(parsed.options);
    const usage: AiTokenUsage = {
      model: this.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      callCount: 1,
    };
    logger.info(
      { questionNumber: input.questionNumber, options: options.length },
      'question re-extract done',
    );
    return {
      stem: asString(parsed.stem).trim(),
      options,
      answer: asString(parsed.answer).trim(),
      explanation: asStringOrNull(parsed.explanation),
      usage,
    };
  }
}
