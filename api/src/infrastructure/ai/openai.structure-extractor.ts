import { OpenAI } from 'openai';
import { z } from 'zod';
import {
  type StructureEstimate,
  type StructureExtractedCrop,
  type StructureTextCrop,
} from '@ingest/contracts';
import type { StructureExtractor } from '../../modules/ingestion/index.js';
import {
  StructurePageAccumulator,
  StructurePageObservationSchema,
  structureHeadingCandidates,
  structureQuestionTypeEvidence,
  structureCropContextKey,
  reusableStructureCrop,
  structureRequestGroups,
  type StructurePageObservation,
  type StructureHeadingCandidates,
  type StructureQuestionTypeEvidence,
} from '../../modules/ingestion/index.js';
import {
  STRUCTURE_SYSTEM_PROMPT,
  structureJsonSchema,
  structurePrompt,
} from './prompts/structure-prompts.js';
import {
  estimateStructure,
  structureCostUsd,
  structurePricing,
  STRUCTURE_OUTPUT_TOKEN_LIMIT,
} from './structure-cost.js';

const BatchResponseSchema = z
  .object({
    crops: z.array(
      z.object({ cropId: z.string(), items: StructurePageObservationSchema.shape.items }).strict(),
    ),
  })
  .strict();

type ExtractionInput = Parameters<StructureExtractor['extract']>[0];
type ReviewedCrop = StructureTextCrop & {
  candidates: StructureHeadingCandidates;
  questionTypeEvidence: StructureQuestionTypeEvidence[];
};
type CropOutcome =
  | { kind: 'saved'; crop: ReviewedCrop; items: StructurePageObservation['items'] }
  | {
      kind: 'requested';
      crop: ReviewedCrop;
      response: OpenAI.Chat.Completions.ChatCompletion | null;
    }
  | { kind: 'blocked'; crop: ReviewedCrop; message: string };

/** Reviewed text only. Code carries hierarchy and grounds each result in its own crop. */
export class OpenAiStructureExtractor implements StructureExtractor {
  private readonly client: OpenAI;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180000 });
  }
  estimate(input: Parameters<StructureExtractor['estimate']>[0]): StructureEstimate {
    return estimateStructure(this.model, input);
  }
  async extract(input: ExtractionInput): Promise<unknown> {
    const accumulator = new StructurePageAccumulator(input.context, input.rule);
    const cropResults: StructureExtractedCrop[] = [];
    const contextKey = structureCropContextKey(input.context, input.rule);
    let aiCallCount = 0;
    let stopped = false;
    let completed = 0;
    const processed = (): void => {
      completed += 1;
      input.onProgress?.({ completed, total: input.crops.length, phase: 'extracting' });
    };
    const orderedCrops = input.assignQuestionPages
      ? [...input.crops].sort((a, b) => a.pageNumber - b.pageNumber)
      : input.crops;
    for (const group of structureRequestGroups(orderedCrops)) {
      const pending: Promise<CropOutcome>[] = [];
      for (const source of group) {
        const crop = this.reviewedCrop(source, input);
        const saved = reusableStructureCrop(source, input.savedCrops, contextKey);
        if (saved || !source.text.trim()) {
          processed();
          pending.push(Promise.resolve({ kind: 'saved', crop, items: saved?.items ?? [] }));
          continue;
        }
        // Check each dispatch serially; record all in-flight usage before admitting another group.
        try {
          await input.beforeBatch?.();
        } catch (error) {
          pending.push(
            Promise.resolve({
              kind: 'blocked',
              crop,
              message: `${error instanceof Error ? error.message : 'Token budget check failed.'} Remaining crops were not requested.`,
            }),
          );
          stopped = true;
          break;
        }
        aiCallCount += 1;
        pending.push(
          this.request(crop, input, accumulator.pageContext()).then((response): CropOutcome => {
            processed();
            return { kind: 'requested', crop, response };
          }),
        );
      }
      // Promise.all preserves reading order even when later crops finish first.
      const outcomes = await Promise.all(pending);
      for (const outcome of outcomes) {
        const { crop } = outcome;
        if (outcome.kind === 'blocked') {
          accumulator.failedPage(crop.pageNumber, outcome.message);
          continue;
        }
        let observations: StructurePageObservation['items'];
        if (outcome.kind === 'saved') observations = outcome.items;
        else {
          if (!outcome.response) {
            accumulator.failedPage(
              crop.pageNumber,
              'The AI request failed or timed out. No further groups will be requested; other in-flight results and saved OCR text can be reused.',
            );
            stopped = true;
            continue;
          }
          await this.recordUsage(outcome.response, crop, input, accumulator);
          const parsed = this.responseItems(outcome.response, crop, accumulator);
          if (!parsed) continue;
          observations = parsed;
        }
        const items = accumulator.accept(
          crop.pageNumber,
          { items: observations },
          crop.candidates,
          crop.questionTypeEvidence,
          crop.role,
        );
        cropResults.push({
          cropId: crop.id,
          text: crop.text,
          role: crop.role ?? 'combined',
          contextKey,
          items,
        });
      }
      if (stopped) break;
    }
    input.onProgress?.({ completed, total: input.crops.length, phase: 'building' });
    return {
      ...accumulator.result(input.assignQuestionPages ? input.pageCount : undefined),
      cropResults,
      aiCallCount,
    };
  }

  private reviewedCrop(crop: StructureTextCrop, input: ExtractionInput): ReviewedCrop {
    const lines = crop.text.split(/\r?\n/u);
    return {
      ...crop,
      candidates: structureHeadingCandidates(
        lines.filter(
          (line) =>
            Boolean(input.rule?.hierarchy) ||
            (crop.role !== undefined && crop.role !== 'combined') ||
            line.trim().toLowerCase() !== input.context.chapter.trim().toLowerCase(),
        ),
        input.rule,
        true,
        crop.role,
      ),
      questionTypeEvidence: structureQuestionTypeEvidence(lines),
    };
  }

  private async request(
    crop: ReviewedCrop,
    input: ExtractionInput,
    state: ReturnType<StructurePageAccumulator['pageContext']>,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | null> {
    try {
      return await this.client.chat.completions.create({
        model: this.model,
        ...(/^gpt-5\.4(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$/.test(this.model)
          ? { reasoning_effort: 'high' as const }
          : {}),
        max_completion_tokens: STRUCTURE_OUTPUT_TOKEN_LIMIT,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'crop_structure',
            strict: true,
            schema: structureJsonSchema(
              input.rule,
              crop.candidates,
              [crop.id],
              crop.questionTypeEvidence,
              crop.role,
            ),
          },
        },
        messages: [
          { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: structurePrompt(input.context, [crop], state, input.rule),
          },
        ],
      });
    } catch {
      // The caller drains the group before stopping, so completed siblings are still billed.
      return null;
    }
  }

  private async recordUsage(
    response: OpenAI.Chat.Completions.ChatCompletion,
    crop: ReviewedCrop,
    input: ExtractionInput,
    accumulator: StructurePageAccumulator,
  ): Promise<void> {
    if (response.usage) {
      const model = response.model || this.model;
      const promptTokens = response.usage.prompt_tokens;
      const completionTokens = response.usage.completion_tokens;
      const cachedPromptTokens = response.usage.prompt_tokens_details?.cached_tokens ?? 0;
      const pricing = structurePricing(model, promptTokens);
      await input.onUsage({
        model,
        promptTokens,
        completionTokens,
        totalTokens: response.usage.total_tokens,
        cachedPromptTokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        callCount: 1,
        pricing,
        costUsd: structureCostUsd(pricing, promptTokens, completionTokens, cachedPromptTokens),
      });
    } else
      accumulator.warning(
        `Crop ${crop.id}: provider token usage is unavailable; reported cost totals are incomplete.`,
      );
  }

  private responseItems(
    response: OpenAI.Chat.Completions.ChatCompletion,
    crop: ReviewedCrop,
    accumulator: StructurePageAccumulator,
  ): StructurePageObservation['items'] | undefined {
    const choice = response.choices[0];
    let parsed: z.SafeParseReturnType<unknown, z.infer<typeof BatchResponseSchema>>;
    try {
      parsed = BatchResponseSchema.safeParse(JSON.parse(choice?.message.content ?? '') as unknown);
    } catch {
      parsed = BatchResponseSchema.safeParse(null);
    }
    if (choice?.message.refusal || choice?.finish_reason !== 'stop' || !parsed.success) {
      accumulator.failedPage(
        crop.pageNumber,
        `Crop ${crop.id}: incomplete or invalid AI response. Review manually; no automatic retry.`,
      );
      return undefined;
    }
    if (parsed.data.crops.some((value) => value.cropId !== crop.id))
      accumulator.warning('The AI returned unknown crop IDs; those results were ignored.');
    const matches = parsed.data.crops.filter((value) => value.cropId === crop.id);
    const match = matches[0];
    if (matches.length !== 1 || !match) {
      accumulator.failedPage(
        crop.pageNumber,
        `Crop ${crop.id}: missing or duplicated result. Review manually.`,
      );
      return undefined;
    }
    if (
      Object.values(crop.candidates).every((values) => !values.length) &&
      !crop.questionTypeEvidence.length
    )
      accumulator.warning(
        `Crop ${crop.id} (page ${String(crop.pageNumber)}): no recognizable heading markers. Review the text and saved source rules.`,
      );
    return match.items;
  }
}
