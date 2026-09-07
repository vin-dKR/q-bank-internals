import { OpenAI } from 'openai';
import type { Document, MatchData } from '@ingest/contracts';
import type {
  AnswerExtraction,
  AnswerSheet,
  ExtractedQuestion,
  ExtractionProgress,
  PageImage,
  QuestionExtraction,
  VisionExtractor,
} from '../../modules/extraction/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { errors } from '../../shared/errors/error-catalog.js';
import { logger } from '../../shared/logger/logger.js';
import { answerPrompt, questionPrompt, solutionPrompt } from './prompts/extraction-prompts.js';
import type { PromptOverrides } from '../../modules/prompts/index.js';

/**
 * Output-token budget for the first attempt at one page. Covers a reasoning model's hidden reasoning
 * AND the page's question JSON; the retry doubles it once if the model still truncates.
 */
const MAX_TOKENS = 16000;

/** Shape the question prompt asks the model to return, before we enrich with section/page. */
type RawQuestion = {
  question_number?: unknown;
  question_text?: unknown;
  options?: unknown;
  /** Only present for comprehension questions — the shared passage, repeated on each sub-question. */
  passage?: unknown;
  /** Only present for comprehension sub-questions — that sub-question's OWN real type (a group holds
   *  questions of any type: single_correct, multi_correct, matrix, …). */
  question_type?: unknown;
  /** Only present for matrix-match questions — the ordered columns and (optionally) the answer key. */
  columns?: unknown;
  match?: unknown;
  /** Present only when the question page itself prints the answer / worked solution. */
  answer?: unknown;
  explanation?: unknown;
  /** Present only on a PYQ segment — the source exam + year the model read off the page. */
  pyq_exam?: unknown;
  pyq_year?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Build structured match-the-column data from a matrix question's raw `columns`/`match`. Returns null
 * unless at least two well-formed columns are present, so a non-matrix (or malformed) response simply
 * falls back to the ordinary question path. The key keeps only string→string[] entries.
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
    private readonly loadPromptOverrides: () => Promise<PromptOverrides>,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extractQuestions(input: {
    pages: PageImage[];
    document: Document;
    signal?: AbortSignal;
    onProgress?: (progress: ExtractionProgress) => Promise<void>;
  }): Promise<QuestionExtraction> {
    const results: ExtractedQuestion[] = [];
    const usage = this.emptyUsage();
    const pagesTotal = input.pages.length;
    let pagesDone = 0;
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      // Per page: the topic config can bind different pages to different fixed question types.
      const prompt = questionPrompt(input.document, page.pageNumber, overrides);
      const raws = await this.readPageQuestions(prompt, page, input.document, usage, input.signal);
      for (const raw of raws) {
        results.push({
          questionNumber: toQuestionNumber(raw.question_number),
          questionText: asString(raw.question_text),
          options: Array.isArray(raw.options) ? raw.options.map(asString).filter(Boolean) : [],
          answer: asStringOrNull(raw.answer),
          explanation: asStringOrNull(raw.explanation),
          sectionName: input.document.sectionName,
          // A comprehension member returns its OWN real type; ordinary pages don't emit question_type,
          // so this falls back to the document type (only consulted for comprehension members in
          // toNewQuestion — the operator's binding fixes an ordinary question's type).
          questionType: asStringOrNull(raw.question_type) ?? input.document.questionType,
          sourcePage: page.pageNumber,
          pyqExam: asStringOrNull(raw.pyq_exam),
          pyqYear: asStringOrNull(raw.pyq_year),
          match: toMatchData(raw.columns, raw.match),
          passage: asStringOrNull(raw.passage),
          // passageId/groupOrder are assigned later by materializePassages (post answer-merge), not here.
          passageId: null,
          groupOrder: null,
        });
      }
      pagesDone += 1;
      if (input.onProgress) {
        await input.onProgress({ pagesTotal, pagesDone, questionsFound: results.length });
      }
    }
    logger.info(
      { documentId: input.document.id, model: this.model, pages: input.pages.length, questions: results.length },
      'question extraction done',
    );
    return { questions: results, usage };
  }

  async extractAnswers(input: {
    pages: PageImage[];
    document: Document;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction> {
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      // Per page: the topic config can bind different pages to different fixed question types, so the
      // answer-value format is resolved per page (mirrors extractQuestions).
      const prompt = answerPrompt(input.document, page.pageNumber, overrides);
      const { content } = await this.call(prompt, page.png, usage, input.signal);
      sheets.push(...parseAnswerSheets(content, input.document.sectionName));
    }
    return { sheets, usage };
  }

  async extractSolutions(input: {
    pages: PageImage[];
    document: Document;
    signal?: AbortSignal;
  }): Promise<AnswerExtraction> {
    const sheets: AnswerExtraction['sheets'] = [];
    const usage = this.emptyUsage();
    const overrides = await this.loadPromptOverrides();
    for (const page of input.pages) {
      const prompt = solutionPrompt(input.document, page.pageNumber, overrides);
      const { content } = await this.call(prompt, page.png, usage, input.signal);
      sheets.push(...parseSolutionSheets(content, input.document.sectionName));
    }
    return { sheets, usage };
  }

  /**
   * Read one page's questions, retrying once if the first reply parses to zero. A page that returns no
   * questions is the clearest "possible skip" — a single retry recovers a transient, misshaped reply
   * before we accept the page as genuinely blank (a real blank page simply returns zero again, logged
   * for visibility). {@link call} already handles truncation/empty replies, so this only guards the
   * "parsed fine, but no questions" case that used to drop a whole page silently.
   */
  private async readPageQuestions(
    prompt: string,
    page: PageImage,
    document: Document,
    usage: AiTokenUsage,
    signal?: AbortSignal,
  ): Promise<RawQuestion[]> {
    const first = parseQuestions((await this.call(prompt, page.png, usage, signal)).content);
    if (first.length > 0) return first;
    const retry = parseQuestions((await this.call(prompt, page.png, usage, signal)).content);
    if (retry.length === 0) {
      logger.warn(
        { documentId: document.id, page: page.pageNumber },
        'Page yielded no questions after a retry — treating it as blank',
      );
    }
    return retry;
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

  /**
   * One vision call for one page. Folds every attempt's token usage into `usage` (mutated across the
   * page loop) so a retry is billed honestly. `signal` (when present) aborts the request the instant
   * the run is cancelled or its deadline fires.
   *
   * Guards truncation the way the sibling re-extractor and detector do. A reasoning model can spend
   * its whole output budget on hidden reasoning and return a truncated (or empty) reply, and the
   * parsers here turn unparseable JSON into an empty array — so without this guard a truncated page
   * persisted as "no questions on this page", silently, with the job still green. Retry once at
   * double the budget, then throw: a failed job names the document, an empty one hides it.
   */
  private async call(
    prompt: string,
    png: Buffer,
    usage: AiTokenUsage,
    signal?: AbortSignal,
  ): Promise<{ content: string }> {
    const imageUrl = `data:image/png;base64,${png.toString('base64')}`;
    let content = '';
    let maxCompletionTokens = MAX_TOKENS;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          // `max_completion_tokens` (not `max_tokens`) and default temperature so the same code runs on
          // gpt-4o and on the newer reasoning models (e.g. gpt-5.4-mini), which reject `max_tokens` and
          // any non-default temperature — see the sibling diagram detector.
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
        },
        signal ? { signal } : undefined,
      );
      usage.promptTokens += response.usage?.prompt_tokens ?? 0;
      usage.completionTokens += response.usage?.completion_tokens ?? 0;
      usage.totalTokens += response.usage?.total_tokens ?? 0;
      usage.callCount += 1;

      const choice = response.choices[0];
      content = choice?.message.content?.trim() ?? '';
      const truncated = choice?.finish_reason === 'length';
      if (!truncated && content) break;

      logger.warn(
        {
          model: this.model,
          attempt,
          maxCompletionTokens,
          finishReason: choice?.finish_reason,
          empty: content.length === 0,
        },
        'Extraction reply truncated or empty — retrying at a larger token budget',
      );
      if (attempt === 2) {
        throw errors.extractionFailed(
          `The model returned ${truncated ? 'a truncated' : 'an empty'} reply for a page, even at ${String(maxCompletionTokens)} tokens. The page is likely too dense — split it, or raise the extractor's token budget.`,
        );
      }
      maxCompletionTokens *= 2;
    }

    return { content };
  }
}
