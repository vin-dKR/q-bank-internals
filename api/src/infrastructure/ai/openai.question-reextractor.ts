import { OpenAI } from 'openai';
import type { MatchData, QuestionOption } from '@ingest/contracts';
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
type RawReExtract = {
  stem?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  columns?: unknown;
  match?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Coerce a model-supplied option label to a canonical A/B/C/D, labelling by position as a fallback.
 * Matches the batch path's `parseOption` (extraction.worker): only a bare A–D / 1–4 token is trusted;
 * anything else (a leaked match-column label like "p", a run-on like "AAPB") falls back to the
 * positional letter, so re-read options can never come back with garbage labels.
 */
function normalizeLabel(raw: unknown, index: number): string {
  const token = asString(raw).trim().replace(/[()[\].]/g, '');
  if (/^[A-Da-d]$/.test(token)) return token.toUpperCase();
  if (/^[1-4]$/.test(token)) return String.fromCharCode(64 + Number(token));
  return String.fromCharCode(65 + index); // A, B, C, D by position
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

/** Normalise the raw `options` array into the contract shape, forcing A/B/C/D labels. */
function toOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawOption[]).map((item, index) => ({
    label: normalizeLabel(item.label, index),
    body: asString(item.body).trim(),
    isCorrect: item.is_correct === true,
  }));
}

/**
 * Build structured match-the-column data from a matrix question's raw `columns`/`match`, mirroring
 * {@link OpenAiVisionExtractor}'s batch-path `toMatchData`. Returns null unless at least two
 * well-formed columns are present, so a non-matrix (or malformed) reply simply falls back to the
 * ordinary option path rather than persisting a half-built table. The key keeps only string→string[].
 */
function toMatchData(rawColumns: unknown, rawMatch: unknown): MatchData | null {
  if (!Array.isArray(rawColumns)) return null;
  const columns: MatchData['columns'] = [];
  for (const rawColumn of rawColumns) {
    const record = rawColumn as { title?: unknown; entries?: unknown };
    const entries = Array.isArray(record.entries)
      ? record.entries
          .map((rawEntry) => {
            const entry = rawEntry as { label?: unknown; body?: unknown };
            return { label: asString(entry.label).trim(), body: asString(entry.body) };
          })
          .filter((entry) => entry.label.length > 0)
      : [];
    if (entries.length > 0) columns.push({ title: asString(record.title), entries });
  }
  if (columns.length < 2) return null;

  const key: Record<string, string[]> = {};
  if (rawMatch && typeof rawMatch === 'object') {
    for (const [label, targets] of Object.entries(rawMatch as Record<string, unknown>)) {
      const list = Array.isArray(targets)
        ? targets.map(asString).map((t) => t.trim()).filter(Boolean)
        : [];
      if (list.length > 0) key[label.trim()] = list;
    }
  }
  return { columns, key };
}

/**
 * For a matrix question the columns live in the structured table, so strip any column DUMP the model
 * also pasted into the stem (the reported duplication: the same Column-I/Column-II lists showing both
 * in the question text and the match table). We keep only the instruction that precedes the first line
 * that is a column HEADING — a line whose trimmed text starts with "Column" (e.g. "Column–I",
 * "Column II (Velocity)"). The instruction itself ("Match the column-I with column-II …") is one line
 * and never starts with "Column", so it survives. If no heading line is found, or the stem starts with
 * one (no instruction to keep), the stem is returned unchanged rather than risk emptying it.
 */
function stripMatchColumnsFromStem(stem: string): string {
  const lines = stem.split('\n');
  const headingIndex = lines.findIndex((line) => /^\s*column\b/i.test(line));
  if (headingIndex <= 0) return stem.trim();
  return lines.slice(0, headingIndex).join('\n').trim();
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
    // A MATRIX MATCH question stores structured columns instead of options — parse them first, and when
    // present clear options so the flat option array is never cluttered with leaked column entries
    // (the "1 4 1 2 3 4 / same value four times" garbage). Non-matrix replies leave match null.
    const match = toMatchData(parsed.columns, parsed.match);
    // A matrix question keeps BOTH: the structured columns/key AND the printed multiple-choice options
    // (each a full matching like "A-i, B-ii, …"), so the operator can click a printed option to fill the
    // grid. Labels are still forced to A/B/C/D by toOptions, so a leaked column label can't survive.
    const options = toOptions(parsed.options);
    // When the columns are stored structurally, remove any duplicate column dump the model left in the
    // stem so the same lists don't appear twice (question text + match table).
    const rawStem = asString(parsed.stem).trim();
    const stem = match ? stripMatchColumnsFromStem(rawStem) : rawStem;
    const answer = asString(parsed.answer).trim();
    const explanation = asStringOrNull(parsed.explanation);
    // A genuine question always has a stem, options, or a match table; a reply with none means the read
    // failed (bad JSON, wrong page, refusal) rather than a truly blank question — don't hand back a wipe.
    if (!stem && options.length === 0 && !match && !answer && !explanation) {
      throw errors.extractionFailed(
        'The model could not read this question from the page. Please try again or edit the field manually.',
      );
    }
    const usage: AiTokenUsage = { model: this.model, promptTokens, completionTokens, totalTokens, callCount };
    logger.info(
      { questionNumber: input.questionNumber, options: options.length, match: match !== null },
      'question re-extract done',
    );
    return { stem, options, answer, explanation, match, usage };
  }
}
