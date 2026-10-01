import { OpenAI } from 'openai';
import { z } from 'zod';
import {
  STRUCTURE_HEADING_LEVELS,
  type StructureEstimate,
  type StructureExtractedCrop,
} from '@ingest/contracts';
import type {
  StructureExtractor,
  StructureHeadingCandidates,
} from '../../modules/ingestion/index.js';
import {
  StructurePageAccumulator,
  StructurePageObservationSchema,
  structureHeadingCandidates,
  structureQuestionTypeEvidence,
  structureCropContextKey,
  reusableStructureCrop,
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
  async extract(input: Parameters<StructureExtractor['extract']>[0]): Promise<unknown> {
    const accumulator = new StructurePageAccumulator(input.context, input.rule);
    const cropResults: StructureExtractedCrop[] = [];
    const contextKey = structureCropContextKey(input.context, input.rule);
    let aiCallCount = 0;
    for (const first of input.crops) {
      const batch = [first];
      const crops = batch.map((crop) => ({
        ...crop,
        candidates: structureHeadingCandidates(
          crop.text
            .split(/\r?\n/u)
            .filter(
              (line) => line.trim().toLowerCase() !== input.context.chapter.trim().toLowerCase(),
            ),
          input.rule,
          true,
        ),
        questionTypeEvidence: structureQuestionTypeEvidence(crop.text.split(/\r?\n/u)),
      }));
      const candidates: StructureHeadingCandidates = { section: [], part: [], topic: [] };
      for (const crop of crops)
        for (const level of STRUCTURE_HEADING_LEVELS)
          candidates[level].push(
            ...crop.candidates[level].filter((value) => !candidates[level].includes(value)),
          );
      const current = crops[0];
      if (!current) continue;
      const saved = reusableStructureCrop(first, input.savedCrops, contextKey);
      if (saved || !first.text.trim()) {
        const items = accumulator.accept(
          first.pageNumber,
          { items: saved?.items ?? [] },
          current.candidates,
          current.questionTypeEvidence,
        );
        cropResults.push({ cropId: first.id, text: first.text, contextKey, items });
        continue;
      }
      try {
        await input.beforeBatch?.();
      } catch (error) {
        accumulator.failedPage(
          first.pageNumber,
          `${error instanceof Error ? error.message : 'Token budget check failed.'} Remaining crops were not requested.`,
        );
        break;
      }
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        aiCallCount += 1;
        response = await this.client.chat.completions.create({
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
                candidates,
                crops.map((crop) => crop.id),
                crops.flatMap((crop) => crop.questionTypeEvidence),
              ),
            },
          },
          messages: [
            { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: structurePrompt(input.context, crops, accumulator.pageContext(), input.rule),
            },
          ],
        });
      } catch {
        accumulator.failedPage(
          first.pageNumber,
          'The AI request failed or timed out. Remaining crops were not requested; saved OCR text can be reused.',
        );
        break;
      }
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
          `Crop ${first.id}: provider token usage is unavailable; reported cost totals are incomplete.`,
        );
      const choice = response.choices[0];
      let parsed: z.SafeParseReturnType<unknown, z.infer<typeof BatchResponseSchema>>;
      try {
        parsed = BatchResponseSchema.safeParse(
          JSON.parse(choice?.message.content ?? '') as unknown,
        );
      } catch {
        parsed = BatchResponseSchema.safeParse(null);
      }
      if (choice?.message.refusal || choice?.finish_reason !== 'stop' || !parsed.success) {
        for (const crop of crops)
          accumulator.failedPage(
            crop.pageNumber,
            `Crop ${crop.id}: incomplete or invalid AI response. Review manually; no automatic retry.`,
          );
        continue;
      }
      if (parsed.data.crops.some((value) => !crops.some((crop) => crop.id === value.cropId)))
        accumulator.warning('The AI returned unknown crop IDs; those results were ignored.');
      for (const crop of crops) {
        const matches = parsed.data.crops.filter((value) => value.cropId === crop.id);
        const match = matches[0];
        if (matches.length !== 1 || !match) {
          accumulator.failedPage(
            crop.pageNumber,
            `Crop ${crop.id}: missing or duplicated result. Review manually.`,
          );
          continue;
        }
        if (
          Object.values(crop.candidates).every((values) => !values.length) &&
          !crop.questionTypeEvidence.length
        )
          accumulator.warning(
            `Crop ${crop.id} (page ${String(crop.pageNumber)}): no recognizable heading markers. Review the text and saved source rules.`,
          );
        const items = accumulator.accept(
          crop.pageNumber,
          { items: match.items },
          crop.candidates,
          crop.questionTypeEvidence,
        );
        cropResults.push({ cropId: crop.id, text: crop.text, contextKey, items });
      }
    }
    return { ...accumulator.result(), cropResults, aiCallCount };
  }
}
