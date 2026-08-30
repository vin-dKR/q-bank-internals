import { OpenAI } from 'openai';
import { EMPTY_PAPER_METADATA, PAPER_METADATA_FIELDS, type PaperMetadata } from '@ingest/contracts';
import type {
  PaperMetadataExtraction,
  PaperMetadataExtractor,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { paperMetadataPrompt } from './prompts/extraction-prompts.js';

/** Output-token budget for the read; the retry doubles it once if a reasoning model truncates. */
const MAX_TOKENS = 4000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parse the model's reply, tolerating the ways a vision model wraps JSON — a bare object, a ```json
 * fence, or an object with prose around it — so a stray wrapper never drops the whole read.
 */
function parseReply(content: string): Record<string, unknown> {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidate = fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);
  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Keep only the known paper keys, coercing each to a trimmed string (absent → ''). */
function toPaperMetadata(raw: Record<string, unknown>): PaperMetadata {
  const paper: PaperMetadata = { ...EMPTY_PAPER_METADATA };
  for (const { key } of PAPER_METADATA_FIELDS) paper[key] = asString(raw[key]).trim();
  return paper;
}

/**
 * {@link PaperMetadataExtractor} backed by an OpenAI vision model — one call reads the paper's header
 * page image and returns its whole-paper metadata. Mirrors {@link OpenAiQuestionReExtractor}'s call
 * shape (`max_completion_tokens`, `response_format: json_object`, retry-on-truncation) so the same
 * code runs on gpt-4o and the newer reasoning models. Runs on the API request path (interactive).
 */
export class OpenAiPaperMetadataExtractor implements PaperMetadataExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(input: { png: Buffer }): Promise<PaperMetadataExtraction> {
    const prompt = paperMetadataPrompt();
    const imageUrl = `data:image/png;base64,${input.png.toString('base64')}`;

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let callCount = 0;

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
        'paper-metadata read reply truncated or empty — retrying at a larger token budget',
      );
      if (attempt === 2) {
        throw errors.extractionFailed(
          `The model returned ${truncated ? 'a truncated' : 'an empty'} reply while reading the paper header, even at ${String(maxCompletionTokens)} tokens. Please try again.`,
        );
      }
      maxCompletionTokens *= 2;
    }

    const paper = toPaperMetadata(parseReply(content));
    const usage: AiTokenUsage = { model: this.model, promptTokens, completionTokens, totalTokens, callCount };
    logger.info(
      { examName: paper.pyqExamName, examYear: paper.pyqExamYear },
      'paper-metadata read done',
    );
    return { paper, usage };
  }
}
