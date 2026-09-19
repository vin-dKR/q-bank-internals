import { OpenAI } from 'openai';
import { z } from 'zod';
import { AI_FIX_FIELDS, MatchDataSchema, QUESTION_LEVELS, type AiFixField } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import { fillTokens, resolvePrompt, type PromptOverrides } from '../../modules/prompts/index.js';
import type {
  AiFixInput,
  AiFixOutput,
  AuditQuestion,
  ChapterChoiceInput,
  ChapterChoiceOutput,
  QuestionAiFixer,
  TopicOption,
} from '../../modules/quality/index.js';

/** The prompt block that explains each requested field, in the order the model should work through them. */
const FIELD_PROMPT = {
  topic: 'qualityTopic',
  answer: 'qualityAnswer',
  solution: 'qualitySolution',
  level: 'qualityLevel',
  structure: 'qualityStructure',
} as const satisfies Record<AiFixField, string>;

/**
 * The rebuilt structure, validated into the app's own match shape. A table that comes back malformed is
 * dropped whole rather than half-kept — half a table is worse than none — and so is an empty one.
 */
const ReplyStructureSchema = z
  .object({
    match: MatchDataSchema.nullable().catch(null),
    passage: z.string().nullable().catch(null),
  })
  .nullable()
  .catch(null)
  .transform((structure) => (structure && (structure.match !== null || structure.passage !== null) ? structure : null));

/** The reply shape. Every field is nullable: "I could not decide" must be expressible, so it is never guessed. */
const ReplySchema = z.object({
  topic: z.string().nullable().catch(null),
  answer: z.string().nullable().catch(null),
  solution: z.string().nullable().catch(null),
  level: z.enum(QUESTION_LEVELS).nullable().catch(null),
  structure: ReplyStructureSchema,
  confidence: z.coerce.number().min(0).max(1).catch(0),
  notes: z.string().catch(''),
});

/** The chapter call's reply: an id to check, not a chapter to trust. */
const ChapterReplySchema = z.object({
  chapter: z.string().nullable().catch(null),
  confidence: z.coerce.number().min(0).max(1).catch(0),
  notes: z.string().catch(''),
});

/** The JSON object to return: the call's own fields, then the confidence and notes every call reports. */
function jsonShape(fieldLines: readonly string[]): string {
  const lines = [
    ...fieldLines,
    '  "confidence": number between 0 and 1',
    '  "notes": string (empty when there is nothing to flag)',
  ];
  return `{\n${lines.join(',\n')}\n}`;
}

/** The JSON shape asked for, built from the requested fields so the model is not offered fields to invent. */
function replyShape(fields: readonly AiFixField[]): string {
  return jsonShape(
    AI_FIX_FIELDS.filter((field) => fields.includes(field)).map((field) => {
      if (field === 'level') return `  "level": "easy" | "medium" | "hard" | null`;
      if (field === 'topic') return `  "topic": the chosen topic's ID exactly as listed, or null`;
      if (field === 'structure') {
        return (
          '  "structure": { "match": { "columns": [{ "title": string, "entries": [{ "label": string, "body": string }] }], ' +
          '"key": { "A": ["p"] } } | null, "passage": string | null } | null'
        );
      }
      return `  "${field}": string | null`;
    }),
  );
}

/** Classifying (chapter or topic) reads the text; the figures are only worth sending when there is barely any. */
function classifyImages(question: AuditQuestion, imageUrls: string[]): string[] {
  return question.questionText.trim().length < 40 ? imageUrls : [];
}

/**
 * The allowed topics as an id → topic table, grouped under the chapter each belongs to. The model answers
 * with an ID, not the text, so it cannot half-copy a topic, reword one, or return a chapter heading — the
 * three ways a text answer used to be rejected.
 */
function topicList(topics: readonly TopicOption[]): string {
  const byChapter = new Map<string, TopicOption[]>();
  for (const option of topics) byChapter.set(option.chapter, [...(byChapter.get(option.chapter) ?? []), option]);
  const body = [...byChapter.entries()]
    .map(([chapter, options]) => `Chapter: ${chapter}\n${options.map((o) => `  ${o.id} = ${o.topic}`).join('\n')}`)
    .join('\n');
  return `${body}\n\nAnswer with the ID only (for example "${topics[0]?.id ?? 'C01-T01'}"). Chapter names are context — they are never an answer.`;
}

/** The question exactly as stored, so the model corrects what is there rather than something it imagined. */
function questionBlock(input: Pick<AiFixInput, 'question' | 'imageUrls'>): string {
  const { question } = input;
  const lines = [
    `Exam: ${question.exam ?? '(not stored)'}`,
    `Subject: ${question.subject ?? '(not stored)'}`,
    `Chapter as stored: ${question.chapter ?? '(not stored)'}`,
    `Question type: ${question.questionType ?? '(not stored)'}`,
    `Currently stored topic: ${question.topic ?? '(blank)'}`,
    `Currently stored answer: ${question.answer ?? '(blank)'}`,
    `Currently stored level: ${question.level ?? '(blank)'}`,
    '',
    'QUESTION:',
    question.questionText || '(no text stored — read the attached image)',
  ];
  if (question.passage !== null && question.passage.trim() !== '') {
    lines.push('', 'SHARED PASSAGE (comprehension):', question.passage);
  }
  lines.push('', question.options.length > 0 ? `OPTIONS:\n${question.options.join('\n')}` : 'OPTIONS: none (not a choice question)');
  if (input.imageUrls.length > 0) {
    lines.push('', `${String(input.imageUrls.length)} image(s) belonging to this question are attached.`);
  }
  return lines.join('\n');
}

/**
 * {@link QuestionAiFixer} backed by OpenAI. Composes one call from the editable prompt blocks — the system
 * role plus a block per requested field — and sends the question's figures alongside, so a diagram-dependent
 * question is solved from what it actually shows rather than guessed from its text.
 *
 * The model is never allowed to write anything: the reply is parsed, and the service checks the topic
 * against the vocabulary it offered before the operator sees the proposal.
 */
export class OpenAiQuestionAiFixer implements QuestionAiFixer {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly loadPromptOverrides: () => Promise<PromptOverrides>,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Two calls, run together, because the fields are two different jobs:
   *
   * - TOPIC is a classification against a long controlled list. It gets its own call so the list is not
   *   competing for attention with "solve this question".
   * - ANSWER, SOLUTION and LEVEL come from ONE call, because they must come from ONE solution: the level
   *   is graded from the working that produced the answer. Solving twice would let them disagree.
   */
  async fix(input: AiFixInput): Promise<AiFixOutput> {
    const overrides = await this.loadPromptOverrides();
    const solveFields = SOLVE_FIELDS.filter((field) => input.fields.includes(field));
    // Three jobs, three calls, run together: classify (topic), solve (answer/solution/level), and rebuild the
    // question's shape (structure). Rebuilding is transcription, not solving, so mixing it into the solve call
    // would only invite the model to "improve" what it is meant to copy.
    const [topic, solved, structure] = await Promise.all([
      input.fields.includes('topic') ? this.run(input, overrides, ['topic']) : null,
      solveFields.length > 0 ? this.run(input, overrides, solveFields) : null,
      input.fields.includes('structure') ? this.run(input, overrides, ['structure']) : null,
    ]);

    const parts = [topic, solved, structure].filter((part): part is CallResult => part !== null);
    if (parts.length === 0) throw errors.extractionFailed('no fields were requested for the AI fix.');
    const notes = parts.map((part) => part.reply.notes.trim()).filter(Boolean).join(' ');
    return {
      suggestion: {
        topic: topic?.reply.topic ?? null,
        answer: solved?.reply.answer ?? null,
        solution: solved?.reply.solution ?? null,
        level: solved?.reply.level ?? null,
        structure: structure?.reply.structure ?? null,
        // Filled in by the service, which checks the rebuilt structure against the question.
        structureWarnings: [],
        // The weakest call decides: a confident topic does not make a shaky answer trustworthy.
        confidence: Math.min(...parts.map((part) => part.reply.confidence)),
        notes,
        usedImage: input.imageUrls.length > 0,
        // Filled in by the service, which owns the vocabulary this was checked against.
        topicChoices: 0,
        topicOptions: [],
        topicScope: null,
      },
      usage: {
        model: this.model,
        promptTokens: parts.reduce((sum, part) => sum + part.usage.promptTokens, 0),
        completionTokens: parts.reduce((sum, part) => sum + part.usage.completionTokens, 0),
        totalTokens: parts.reduce((sum, part) => sum + part.usage.totalTokens, 0),
        callCount: parts.length,
      },
    };
  }

  /**
   * Its own call, made before the topic one: the model sees chapter names only, so placing a question costs a
   * few hundred tokens instead of the whole subject's topic table.
   */
  async chooseChapter(input: ChapterChoiceInput): Promise<ChapterChoiceOutput> {
    const overrides = await this.loadPromptOverrides();
    const chapters = input.chapters.map((option) => `  ${option.id} = ${option.chapter}`).join('\n');
    const instructions = [
      questionBlock(input),
      '',
      '=== WHAT TO RETURN ===',
      fillTokens(resolvePrompt(overrides, 'qualityChapter'), { chapters: `${input.scope}\n${chapters}` }),
      '',
      `Return ONLY this JSON object:\n${jsonShape([`  "chapter": the chosen chapter's ID exactly as listed, or null`])}`,
    ].join('\n');

    const { json, usage } = await this.complete(overrides, instructions, classifyImages(input.question, input.imageUrls));
    const parsed = ChapterReplySchema.safeParse(json);
    if (!parsed.success) throw errors.extractionFailed('the AI returned malformed JSON while choosing a chapter.');
    return {
      chapterId: parsed.data.chapter,
      confidence: parsed.data.confidence,
      notes: parsed.data.notes,
      usage: { model: this.model, ...usage, callCount: 1 },
    };
  }

  /** One call for one job: the system role, the blocks for these fields, the question, and its figures. */
  private async run(input: AiFixInput, overrides: PromptOverrides, fields: AiFixField[]): Promise<CallResult> {
    const blocks = fields.map((field) => {
      const prompt = resolvePrompt(overrides, FIELD_PROMPT[field]);
      return field === 'topic' ? fillTokens(prompt, { topics: topicList(input.topics) }) : prompt;
    });
    // A reviewer confirmed the type after an answer that did not fit it: the answer is now bound to it. Placed
    // after the field blocks so it overrides the general "A, C when several are correct" rule.
    if (input.confirmedType !== null && fields.includes('answer')) {
      blocks.push(fillTokens(resolvePrompt(overrides, 'qualityTypeLock'), { type: input.confirmedType }));
    }
    const instructions = [
      questionBlock(input),
      '',
      '=== WHAT TO RETURN ===',
      ...blocks,
      '',
      `Return ONLY this JSON object:\n${replyShape(fields)}`,
    ].join('\n');

    // The solving call always needs the figures; the topic call is a classification.
    const solving = fields.some((field) => field !== 'topic');
    const images = solving ? input.imageUrls : classifyImages(input.question, input.imageUrls);

    const { json, usage } = await this.complete(overrides, instructions, images);
    const parsed = ReplySchema.safeParse(json);
    if (!parsed.success) throw errors.extractionFailed('the AI returned malformed JSON while fixing a question.');
    // Only what this call was asked for is kept, so a model that volunteers an extra field cannot
    // overwrite one the other call owns.
    const wanted = <T>(field: AiFixField, value: T): T | null => (fields.includes(field) ? value : null);
    return {
      reply: {
        topic: wanted('topic', parsed.data.topic),
        answer: wanted('answer', parsed.data.answer),
        solution: wanted('solution', parsed.data.solution),
        level: wanted('level', parsed.data.level),
        structure: wanted('structure', parsed.data.structure),
        confidence: parsed.data.confidence,
        notes: parsed.data.notes,
      },
      usage,
    };
  }

  /** Send one set of instructions (with the system role and any figures) and return the reply as parsed JSON. */
  private async complete(
    overrides: PromptOverrides,
    instructions: string,
    images: string[],
  ): Promise<{ json: unknown; usage: CallUsage }> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: resolvePrompt(overrides, 'qualityFixSystem') },
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: instructions },
            ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
          ],
        },
      ],
    });
    return {
      json: safeJson(response.choices[0]?.message.content ?? ''),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }
}

/** The fields that share one solution, so they are decided in a single call. */
const SOLVE_FIELDS = ['answer', 'solution', 'level'] as const satisfies readonly AiFixField[];

type CallUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

type CallResult = { reply: z.infer<typeof ReplySchema>; usage: CallUsage };

/** Parse the reply, returning undefined (not throwing) so the caller reports one clear error. */
function safeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // A truncated or prose reply is a model failure, reported by the caller as malformed JSON.
    return undefined;
  }
}
