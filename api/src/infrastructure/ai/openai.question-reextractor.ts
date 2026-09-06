import { OpenAI } from 'openai';
import type { MatchData, QuestionOption } from '@ingest/contracts';
import type {
  GroupReExtractInput,
  GroupReExtraction,
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractedSubDraft,
  ReExtractInput,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { reExtractGroupPrompt, reExtractQuestionPrompt } from './prompts/extraction-prompts.js';

/**
 * Output-token budget for the first re-extract attempt. Covers a reasoning model's hidden reasoning
 * AND the JSON reply; the retry doubles it once if the model still truncates. A whole-group re-read
 * returns several sub-questions, so it starts from a larger budget.
 */
const MAX_TOKENS = 16000;
const GROUP_MAX_TOKENS = 32000;

/** Shape the re-extract prompt asks the model to return, before we normalise each field. */
type RawOption = { label?: unknown; body?: unknown; is_correct?: unknown };
type RawReExtract = {
  stem?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  columns?: unknown;
  match?: unknown;
  passage?: unknown;
};
/** Shape the group re-extract prompt asks for: the shared passage plus one entry per sub-question. */
type RawGroupQuestion = {
  question_number?: unknown;
  stem?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
};
type RawGroupReExtract = { passage?: unknown; questions?: unknown };

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Parse a model-supplied question number to an int, or null when it is missing/unreadable. */
function toQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const match = /\d+/.exec(asString(value));
  return match ? Number(match[0]) : null;
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
function parseReply(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidate = fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);
  try {
    return JSON.parse(candidate);
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
            return { label: asString(entry.label).trim(), body: asString(entry.body), image: null };
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
 * page image and returns its fields; {@link reExtractGroup} re-reads a whole comprehension block.
 * Mirrors {@link OpenAiVisionExtractor}'s call shape (`max_completion_tokens`,
 * `response_format: json_object`) so the same code runs on gpt-4o and the newer reasoning models.
 * Runs on the API request path (interactive).
 */
export class OpenAiQuestionReExtractor implements QuestionReExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * One vision call over a page image, with the shared truncation guard: a reasoning model can spend
   * its whole output budget on hidden reasoning and return an empty/truncated reply (the "re-read
   * returned nothing and wiped the field" bug). A bigger budget is the only thing that helps, so
   * attempt once at `startTokens`, retry once at double if truncated/empty, then fail loudly. Usage is
   * accumulated across attempts so a retry is billed honestly. Shared by the single and group re-reads.
   */
  private async callVision(
    prompt: string,
    png: Buffer,
    startTokens: number,
  ): Promise<{ content: string; usage: AiTokenUsage }> {
    const imageUrl = `data:image/png;base64,${png.toString('base64')}`;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let callCount = 0;

    let content = '';
    let maxCompletionTokens = startTokens;
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
        're-extract reply truncated or empty — retrying at a larger token budget',
      );
      if (attempt === 2) {
        throw errors.extractionFailed(
          `The model returned ${truncated ? 'a truncated' : 'an empty'} reply while re-reading the page, even at ${String(maxCompletionTokens)} tokens. Please try again.`,
        );
      }
      maxCompletionTokens *= 2;
    }

    const usage: AiTokenUsage = { model: this.model, promptTokens, completionTokens, totalTokens, callCount };
    return { content, usage };
  }

  async reExtract(input: ReExtractInput): Promise<QuestionReExtraction> {
    const prompt = reExtractQuestionPrompt({
      questionNumber: input.questionNumber,
      stemHint: input.stemHint,
      questionType: input.questionType,
    });
    const { content, usage } = await this.callVision(prompt, input.png, MAX_TOKENS);

    const parsed = parseReply(content) as RawReExtract;
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
    // Comprehension sub-question re-read: the passage the page prints above it (null for other types).
    const passage = asStringOrNull(parsed.passage);
    // A genuine question always has a stem, options, or a match table; a reply with none means the read
    // failed (bad JSON, wrong page, refusal) rather than a truly blank question — don't hand back a wipe.
    if (!stem && options.length === 0 && !match && !answer && !explanation && !passage) {
      throw errors.extractionFailed(
        'The model could not read this question from the page. Please try again or edit the field manually.',
      );
    }
    logger.info(
      { questionNumber: input.questionNumber, options: options.length, match: match !== null },
      'question re-extract done',
    );
    return { stem, options, answer, explanation, match, passage, usage };
  }

  async reExtractGroup(input: GroupReExtractInput): Promise<GroupReExtraction> {
    const prompt = reExtractGroupPrompt({
      questionNumbers: input.questionNumbers,
      passageHint: input.passageHint,
    });
    const { content, usage } = await this.callVision(prompt, input.png, GROUP_MAX_TOKENS);

    const parsed = parseReply(content) as RawGroupReExtract;
    const passage = asString(parsed.passage).trim();
    const rawQuestions = Array.isArray(parsed.questions) ? (parsed.questions as RawGroupQuestion[]) : [];
    const subQuestions: ReExtractedSubDraft[] = rawQuestions.map((raw) => ({
      questionNumber: toQuestionNumber(raw.question_number),
      stem: asString(raw.stem).trim(),
      options: toOptions(raw.options),
      answer: asString(raw.answer).trim(),
      explanation: asStringOrNull(raw.explanation),
      // A comprehension sub-question is never a matrix; keep the shape uniform with the single re-read.
      match: null,
    }));
    // The read failed (bad JSON, wrong page, refusal) when it yields neither a passage nor any
    // sub-question — surface it rather than wiping the group's drafts to blanks.
    if (!passage && subQuestions.length === 0) {
      throw errors.extractionFailed(
        'The model could not read this comprehension passage from the page. Please try again or edit the fields manually.',
      );
    }
    logger.info(
      { subQuestions: subQuestions.length, passageChars: passage.length },
      'comprehension group re-extract done',
    );
    return { passage, subQuestions, usage };
  }
}
