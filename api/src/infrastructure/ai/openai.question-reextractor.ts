import { OpenAI } from 'openai';
import {
  mergeMatrixKeyWithAnswer,
  synthesizeMatrixChoiceOptions,
  type MatchData,
  type QuestionOption,
} from '@ingest/contracts';
import type {
  GroupReExtractInput,
  GroupReExtraction,
  QuestionReExtraction,
  QuestionReExtractor,
  ReExtractedSubDraft,
  ReExtractInput,
  SourceAreaTranscription,
  SourceAreaTranscriptionInput,
  TranscribeRegionInput,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import {
  reExtractGroupPrompt,
  reExtractQuestionPrompt,
  transcribeSourceAreaPrompt,
} from './prompts/extraction-prompts.js';
import { sanitizeExtractedLatex } from './latex-sanitizer.js';
import type { PromptOverrides } from '../../modules/prompts/index.js';

/**
 * Output-token budget for the first re-extract attempt. Covers a reasoning model's hidden reasoning
 * AND the JSON reply; the retry doubles it once if the model still truncates. A whole-group re-read
 * returns several sub-questions, so it starts from a larger budget.
 */
const MAX_TOKENS = 16000;
const GROUP_MAX_TOKENS = 32000;
/** A tight selected field does not need the full-page re-extractor's large reasoning budget. */
const AREA_TRANSCRIBE_MAX_TOKENS = 4096;

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
/** Shape the group re-extract prompt asks for: the shared passage plus one entry per sub-question. */
type RawGroupQuestion = {
  member_index?: unknown;
  question_number?: unknown;
  stem?: unknown;
  options?: unknown;
  columns?: unknown;
  match?: unknown;
  answer?: unknown;
  explanation?: unknown;
};
type RawGroupReExtract = { passage?: unknown; questions?: unknown };

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  // Numerical answers routinely arrive as JSON numbers even when the prompt requests strings.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return '';
}

/** Parse a model-supplied question number to an int, or null when it is missing/unreadable. */
function toQuestionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const number = Math.trunc(value);
    return number > 0 ? number : null;
  }
  const match = /\d+/.exec(asString(value));
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Parse a zero-based comprehension-member index, or null when the model omitted/garbled it. */
function toMemberIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/** Preserve a short printed label; use a stable ordinal only when the model leaks prose or a column row. */
function normalizeLabel(raw: unknown, index: number): string {
  const token = asString(raw)
    .trim()
    .replace(/^[([{\s]+|[)\]}\s.:]+$/g, '');
  if (/^[A-Za-z0-9]{1,12}$/.test(token)) return token;
  return index < 26 ? String.fromCharCode(65 + index) : `Option${String(index + 1)}`;
}

/** A model string with its mhchem `\ce{…}` JSON-escape corruption repaired (see {@link sanitizeExtractedLatex}), trimmed. */
function cleanString(value: unknown): string {
  return sanitizeExtractedLatex(asString(value)).trim();
}

/** Non-empty repaired string, or null — keeps a blank answer/explanation an explicit absence. */
function cleanStringOrNull(value: unknown): string | null {
  const text = cleanString(value);
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
  const candidate =
    fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);
  try {
    return JSON.parse(candidate);
  } catch {
    return {};
  }
}

function stringOption(value: string): { label: string; body: string } {
  const match = /^\s*(?:\(\s*([^()]+?)\s*\)|([A-Za-z0-9]+)\s*[.)])\s*([\s\S]*)$/.exec(value);
  const label = match?.[1] ?? match?.[2] ?? '';
  return { label, body: match?.[3] ?? value };
}

/** Normalise the raw `options` array into the contract shape without erasing 5th/Roman/custom labels. */
function toOptions(raw: unknown): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    const source =
      typeof item === 'string'
        ? stringOption(item)
        : item && typeof item === 'object'
          ? (item as RawOption)
          : null;
    if (!source) return [];
    const body = cleanString(source.body);
    if (!body && typeof item !== 'string') return [];
    return [
      {
        label: normalizeLabel(source.label, index),
        body,
        isCorrect:
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          (item as RawOption).is_correct === true,
      },
    ];
  });
}

/**
 * Some otherwise-valid model replies use `is_correct` on the printed choices but omit the scalar
 * `answer`.  The editor and downstream answer key use the scalar as their canonical selection, so
 * recover it from the explicitly-marked printed choice rather than leaving a matrix/MCQ blank.
 * A direct-response matrix never has such choices, so it remains untouched.
 */
function answerFromMarkedOptions(options: QuestionOption[], questionType: string | null): string {
  const labels = options
    .filter((option) => option.isCorrect)
    .map((option) => option.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return '';
  if (questionType === 'multi_correct') {
    // Preserve non-letter labels too. Compact A/C style remains natural for ordinary option labels.
    return labels.every((label) => /^[A-Za-z0-9]$/.test(label))
      ? labels.join('')
      : labels.join(', ');
  }
  return labels.length === 1 ? (labels[0] ?? '') : '';
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
            return {
              label: asString(entry.label).trim(),
              body: cleanString(entry.body),
              image: null,
            };
          })
          .filter((entry) => entry.label.length > 0)
      : [];
    if (entries.length > 0) columns.push({ title: cleanString(record.title), entries });
  }
  if (columns.length < 2) return null;

  const key: Record<string, string[]> = {};
  if (rawMatch && typeof rawMatch === 'object') {
    for (const [label, targets] of Object.entries(rawMatch as Record<string, unknown>)) {
      const list = Array.isArray(targets)
        ? targets
            .map(asString)
            .map((t) => t.trim())
            .filter(Boolean)
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
    private readonly loadPromptOverrides: () => Promise<PromptOverrides>,
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
    png: Buffer | readonly Buffer[],
    startTokens: number,
  ): Promise<{ content: string; usage: AiTokenUsage }> {
    const pngs: readonly Buffer[] = Buffer.isBuffer(png) ? [png] : png;
    if (pngs.length === 0) {
      throw errors.extractionFailed('No source page was available to re-read.');
    }
    const imageUrls = pngs.map((image) => `data:image/png;base64,${image.toString('base64')}`);
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
              ...imageUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: { url, detail: 'high' as const },
              })),
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

    const usage: AiTokenUsage = {
      model: this.model,
      promptTokens,
      completionTokens,
      totalTokens,
      callCount,
    };
    return { content, usage };
  }

  async reExtract(input: ReExtractInput): Promise<QuestionReExtraction> {
    const overrides = await this.loadPromptOverrides();
    const prompt = reExtractQuestionPrompt(
      {
        questionNumber: input.questionNumber,
        stemHint: input.stemHint,
        questionType: input.questionType,
        ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
        ...(input.fieldTarget ? { fieldTarget: input.fieldTarget } : {}),
        ...(input.inlineAnswers ? { inlineAnswers: true } : {}),
      },
      overrides,
    );
    const { content, usage } = await this.callVision(prompt, input.png, MAX_TOKENS);

    const parsed = parseReply(content) as RawReExtract;
    // A MATRIX MATCH question stores structured columns instead of options — parse them first, and when
    // present clear options so the flat option array is never cluttered with leaked column entries
    // (the "1 4 1 2 3 4 / same value four times" garbage). Non-matrix replies leave match null.
    const extractedMatch = toMatchData(parsed.columns, parsed.match);
    // A matrix question keeps BOTH: the structured columns/key AND the printed multiple-choice options
    // (each a full matching like "A-i, B-ii, …"), so the operator can click a printed option to fill the
    // grid. `toOptions` keeps real printed labels/counts while still rejecting leaked prose labels.
    const extractedOptions = toOptions(parsed.options);
    // When the columns are stored structurally, remove any duplicate column dump the model left in the
    // stem so the same lists don't appear twice (question text + match table).
    const rawStem = cleanString(parsed.stem);
    const stem = extractedMatch ? stripMatchColumnsFromStem(rawStem) : rawStem;
    const rawAnswer =
      cleanString(parsed.answer) || answerFromMarkedOptions(extractedOptions, input.questionType);
    // A matrix's direct answer map can arrive in `answer` while the visual table arrives separately.
    // Complete only missing rows, then synthesize selections only when the source printed no choices.
    const match = extractedMatch ? mergeMatrixKeyWithAnswer(extractedMatch, rawAnswer) : null;
    const generated =
      match && extractedOptions.length === 0 ? synthesizeMatrixChoiceOptions(match) : null;
    const synthesized = generated?.status === 'generated' ? generated : null;
    const options = synthesized?.options ?? extractedOptions;
    const answer = synthesized?.answer ?? rawAnswer;
    const explanation = cleanStringOrNull(parsed.explanation);
    // A genuine question always has a stem, options, or a match table; a reply with none means the read
    // failed (bad JSON, wrong page, refusal) rather than a truly blank question — don't hand back a wipe.
    if (!stem && options.length === 0 && !match && !answer && !explanation) {
      throw errors.extractionFailed(
        'The model could not read this question from the page. Please try again or edit the field manually.',
      );
    }
    logger.info(
      { questionNumber: input.questionNumber, options: options.length, match: match !== null },
      'question re-extract done',
    );
    return { stem, options, answer, explanation, match, usage };
  }

  /**
   * Transcribe only a user-selected source rectangle. The response is deliberately one text field,
   * so a matrix entry/title action cannot accidentally rewrite its neighbours or full table.
   */
  async transcribeArea(input: SourceAreaTranscriptionInput): Promise<SourceAreaTranscription> {
    const { content, usage } = await this.callVision(
      transcribeSourceAreaPrompt(input.target),
      input.png,
      AREA_TRANSCRIBE_MAX_TOKENS,
    );
    const parsed = parseReply(content) as { text?: unknown };
    const text = cleanString(parsed.text);
    if (!text) {
      throw errors.extractionFailed(
        'The model could not read text from the selected area. Try selecting a tighter or clearer region.',
      );
    }
    logger.info({ target: input.target, chars: text.length }, 'source area transcribed');
    return { text, usage };
  }

  /** Transcribe a field-specific crop while preserving mathematical notation. */
  async transcribeRegion(input: TranscribeRegionInput): Promise<{ text: string; usage: AiTokenUsage }> {
    const prompt = [
      'You are transcribing a cropped region of an exam paper into a question-bank text field.',
      `Destination field: ${input.destination}.`,
      'Return JSON with one string property named "text".',
      'Transcribe every readable item in the crop, in its printed order. Preserve the wording, labels, numbering, punctuation, and mathematical meaning exactly.',
      'Do not solve the problem, explain it, infer content outside the crop, omit repeated items, or add labels that are not printed.',
      'The question bank renders inline LaTeX only when it is enclosed in \\( ... \\). Every mathematical expression must use this exact delimiter form, including short expressions, fractions, equations, symbols, chemical formulas, subscripts, and superscripts.',
      'Keep ordinary prose and answer labels outside math delimiters. In mixed prose, wrap only each mathematical expression, not the whole sentence.',
      'Convert clearly readable printed math notation into equivalent valid LaTeX. Use braces for multi-character subscripts and superscripts, for example \\(x_{12}\\), \\(10^{3}\\), and fractions such as \\(\\frac{22}{425}\\).',
      'For chemistry, use the mhchem command inside inline delimiters, for example \\(\\ce{2H2 + O2 -> 2H2O}\\).',
      'Never emit bare LaTeX commands such as \\frac, \\sqrt, \\ce, or raw math subscript/superscript syntax outside \\( ... \\). Do not use single-dollar math delimiters.',
      'For compact answer keys, preserve each printed question label and its corresponding answer; use line breaks between entries when visible or needed to keep the mapping unambiguous.',
      'If part of the crop is unreadable, transcribe the readable parts faithfully and do not guess the unreadable content. If the entire crop is unreadable or contains no text, return {"text":""}.',
    ].join('\n');
    const { content, usage } = await this.callVision(prompt, input.png, 2000);
    const parsed = parseReply(content) as { text?: unknown };
    const text = cleanString(parsed.text);
    if (!text || text.includes('[[FIGURE]]')) {
      throw errors.extractionFailed('The selected area did not produce readable text. The question was left unchanged.');
    }
    return { text, usage };
  }

  async reExtractGroup(input: GroupReExtractInput): Promise<GroupReExtraction> {
    const overrides = await this.loadPromptOverrides();
    const prompt = reExtractGroupPrompt(
      {
        mode: input.mode,
        members: input.members,
        passageHint: input.passageHint,
        ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
        ...(input.fieldTarget ? { fieldTarget: input.fieldTarget } : {}),
        ...(input.inlineAnswers ? { inlineAnswers: true } : {}),
      },
      overrides,
    );
    const { content, usage } = await this.callVision(prompt, input.pngs, GROUP_MAX_TOKENS);

    const parsed = parseReply(content) as RawGroupReExtract;
    const passage = cleanString(parsed.passage);
    const rawQuestions = Array.isArray(parsed.questions)
      ? (parsed.questions as RawGroupQuestion[])
      : [];
    const subQuestions: ReExtractedSubDraft[] =
      input.mode === 'passage_only'
        ? []
        : rawQuestions.map((raw, position) => {
            const memberIndex = toMemberIndex(raw.member_index);
            const questionNumber = toQuestionNumber(raw.question_number);
            // The group response has no question_type field by design; recover the member's persisted
            // type from the stable member index first, then its printed number, then source order. This
            // lets an otherwise valid `is_correct: true` response retain every multi-correct selection
            // instead of returning a blank scalar answer solely because the model omitted `answer`.
            const member =
              (memberIndex === null ? undefined : input.members[memberIndex]) ??
              (questionNumber === null
                ? undefined
                : input.members.find((candidate) => candidate.questionNumber === questionNumber)) ??
              input.members[position];
            const extractedOptions = toOptions(raw.options);
            const rawAnswer =
              cleanString(raw.answer) ||
              answerFromMarkedOptions(extractedOptions, member?.questionType ?? null);
            const extractedMatch = toMatchData(raw.columns, raw.match);
            const match = extractedMatch
              ? mergeMatrixKeyWithAnswer(extractedMatch, rawAnswer)
              : null;
            const generated =
              match && extractedOptions.length === 0 ? synthesizeMatrixChoiceOptions(match) : null;
            const synthesized = generated?.status === 'generated' ? generated : null;
            return {
              memberIndex,
              questionNumber,
              stem: cleanString(raw.stem),
              options: synthesized?.options ?? extractedOptions,
              answer: synthesized?.answer ?? rawAnswer,
              explanation: cleanStringOrNull(raw.explanation),
              // A comprehension group can contain a matrix child. The service admits this shape only onto a
              // stored matrix row, so a model mistake cannot turn another child into a match-table question.
              match,
            };
          });
    // The read failed (bad JSON, wrong page, refusal) when it yields neither a passage nor any
    // sub-question — surface it rather than wiping the group's drafts to blanks.
    if (!passage && (input.mode === 'passage_only' || subQuestions.length === 0)) {
      throw errors.extractionFailed(
        'The model could not read this comprehension passage from the page. Please try again or edit the fields manually.',
      );
    }
    logger.info(
      {
        mode: input.mode,
        pages: input.pngs.length,
        subQuestions: subQuestions.length,
        passageChars: passage.length,
      },
      'comprehension group re-extract done',
    );
    return { mode: input.mode, passage, subQuestions, usage };
  }
}
