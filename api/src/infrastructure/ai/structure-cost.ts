import type {
  StructureEstimate,
  StructureEstimateRequest,
  StructurePricing,
  StructureRule,
} from '@ingest/contracts';
import {
  STRUCTURE_SYSTEM_PROMPT,
  structureJsonSchema,
  structurePrompt,
} from './prompts/structure-prompts.js';
import {
  structureHeadingCandidates,
  structureQuestionTypeEvidence,
  structureTextBatches,
  structureCropContextKey,
  reusableStructureCrop,
  STRUCTURE_TYPED_CROP_CONCURRENCY,
} from '../../modules/ingestion/index.js';

export const STRUCTURE_OUTPUT_TOKEN_LIMIT = 10000;

/** Standard OpenAI rates, verified 2026-09-30. Unknown models never inherit another model's price. */
export function structurePricing(model: string, promptTokens: number): StructurePricing | null {
  const mini = /^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  const full = /^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  if (!mini && !full) return null;
  const longContext = full && promptTokens > 272000;
  return {
    currency: 'USD',
    inputPerMillion: (mini ? 0.75 : 2.5) * (longContext ? 2 : 1),
    cachedInputPerMillion: (mini ? 0.075 : 0.25) * (longContext ? 2 : 1),
    outputPerMillion: (mini ? 4.5 : 15) * (longContext ? 1.5 : 1),
    sourceUrl: `https://developers.openai.com/api/docs/models/${mini ? 'gpt-5.4-mini' : 'gpt-5.4'}`,
    verifiedAt: '2026-09-30',
  };
}

export function structureCostUsd(
  pricing: StructurePricing | null,
  input: number,
  output: number,
  cached = 0,
): number | null {
  if (!pricing) return null;
  const cachedInput = Math.min(input, cached);
  return (
    ((input - cachedInput) * pricing.inputPerMillion +
      cachedInput * pricing.cachedInputPerMillion +
      output * pricing.outputPerMillion) /
    1_000_000
  );
}

/** Planning heuristic only: PDF preprocessing and model output cannot be known before the call. */
export function estimateStructure(
  model: string,
  input: StructureEstimateRequest & { rule?: StructureRule | null },
): StructureEstimate {
  const contextKey = structureCropContextKey(input.context, input.rule);
  const batches = structureTextBatches(
    input.crops.filter((crop) => !reusableStructureCrop(crop, input.savedCrops, contextKey)),
  );
  const characters = batches.reduce((sum, batch) => {
    const crops = batch.map((crop) => ({
      ...crop,
      candidates: structureHeadingCandidates(
        crop.text.split(/\r?\n/u),
        input.rule,
        true,
        crop.role,
      ),
      questionTypeEvidence: structureQuestionTypeEvidence(crop.text.split(/\r?\n/u)),
    }));
    const candidates = crops[0]?.candidates ?? structureHeadingCandidates([], input.rule);
    return (
      sum +
      STRUCTURE_SYSTEM_PROMPT.length +
      structurePrompt(input.context, crops, undefined, input.rule).length +
      JSON.stringify(
        structureJsonSchema(
          input.rule,
          candidates,
          crops.map((crop) => crop.id),
          crops.flatMap((crop) => crop.questionTypeEvidence),
          batch[0]?.role,
        ),
      ).length +
      1500
    );
  }, 0);
  const inputTokens = {
    min: Math.ceil(characters / 5),
    max: Math.ceil(characters / 3),
  };
  const outputTokens = {
    min: batches.reduce((sum, batch) => sum + batch.length * 110, 0),
    max: batches.length * STRUCTURE_OUTPUT_TOKEN_LIMIT,
  };
  const pricing = structurePricing(model, Math.ceil(inputTokens.min / Math.max(1, batches.length)));
  const min = structureCostUsd(pricing, inputTokens.min, outputTokens.min);
  const max = structureCostUsd(
    structurePricing(model, Math.ceil(inputTokens.max / Math.max(1, batches.length))),
    inputTokens.max,
    outputTokens.max,
  );
  return {
    model,
    pageCount: input.pageCount,
    cropCount: input.crops.length,
    callCount: batches.length,
    inputTokens,
    outputTokens,
    pricing,
    costUsd: min === null || max === null ? null : { min, max },
    assumptions: [
      'Text-based planning range using reviewed crop text, heading/type evidence, saved examples and schema. This is not a spending cap; actual usage can fall outside it.',
      `One nonempty crop per AI call. Up to ${String(STRUCTURE_TYPED_CROP_CONCURRENCY)} typed crops run together; Combined crops run sequentially with preceding heading context. Blank reviewed crops use no AI tokens. Code assigns question pages; supporting attachments remain manual.`,
      'Tesseract OCR uses no OpenAI tokens. Server compute and storage costs are outside this estimate. Images and PDFs are never sent to this AI step.',
      `Input uses roughly 3–5 characters per token and allows for preceding heading context. Output allows up to ${String(STRUCTURE_OUTPUT_TOKEN_LIMIT)} tokens per crop call including reasoning. No automatic retries.`,
      'Uses standard USD API rates without cache discounts, taxes or other extraction steps. Unchanged per-crop AI results are reused when building JSON; changed crop roles, text, metadata or source rules requires a new call.',
    ],
  };
}
