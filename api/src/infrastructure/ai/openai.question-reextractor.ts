import { OpenAI } from 'openai';
import type { QuestionOption } from '@ingest/contracts';
import type {
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractInput,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { reExtractQuestionPrompt } from './prompts/extraction-prompts.js';

/**
 * Output-token budget for the first re-extract attempt. Covers a reasoning model's hidden reasoning
 * AND the JSON reply for one question; the retry doubles it once if the model still truncates.
 */
const MAX_TOKENS = 16000;

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
    const prompt = reExtractQuestionPrompt({
      questionNumber: input.questionNumber,
      stemHint: input.stemHint,
      questionType: input.questionType,
    });
    const imageUrl = `data:image/png;base64,${input.png.toString('base64')}`;

    // Accumulate usage across attempts so a retry is billed honestly, not just the last call.
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let callCount = 0;

    // A reasoning model can spend its whole output budget on hidden reasoning and return an empty (or
    // truncated) reply — the intermittent "re-read returned nothing and wiped the field" bug. A bigger
    // budget is the only thing that helps, so mirror the detector: attempt once at MAX_TOKENS, retry
    // once at double if the reply came back truncated/empty, then fail loudly rather than wipe.
    let content = '';
    let maxCompletionTokens = MAX_TOKENS;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
            ],
          },
        ],
      });
      callCount += 1;
      promptTokens += response.usage?.prompt_tokens ?? 0;
      completionTokens += response.usage?.completion_tokens ?? 0;
      totalTokens += response.usage?.total_tokens ?? 0;

      const choice = response.choices[0];
      content = choice?.message.content?.trim() ?? '';
      const truncated = choice?.finish_reason === 'length';
      if (!truncated && content) break;

      logger.warn(
        { attempt, maxCompletionTokens, finishReason: choice?.finish_reason, empty: !content },
        'question re-extract reply truncated or empty — retrying at a larger token budget',
      );
      if (attempt === 2) {
        throw errors.extractionFailed(
          `The model returned ${truncated ? 'a truncated' : 'an empty'} reply while re-reading the question, even at ${String(maxCompletionTokens)} tokens. Please try again.`,
        );
      }
      maxCompletionTokens *= 2;
    }

    const parsed = parseReply(content);
    const options = toOptions(parsed.options);
    const stem = asString(parsed.stem).trim();
    const answer = asString(parsed.answer).trim();
    const explanation = asStringOrNull(parsed.explanation);
    // A genuine question always has a stem and/or options; a reply with neither means the read failed
    // (bad JSON, wrong page, refusal) rather than a truly blank question — don't hand back an empty wipe.
    if (!stem && options.length === 0 && !answer && !explanation) {
      throw errors.extractionFailed(
        'The model could not read this question from the page. Please try again or edit the field manually.',
      );
    }
    const usage: AiTokenUsage = { model: this.model, promptTokens, completionTokens, totalTokens, callCount };
    logger.info(
      { questionNumber: input.questionNumber, options: options.length },
      'question re-extract done',
    );
    return { stem, options, answer, explanation, usage };
  }
}
