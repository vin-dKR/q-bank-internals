import { z } from 'zod';
import {
  StructureCropSchema,
  StructureExtractedCropSchema,
  type StructureCropBounds,
  type StructureTextCrop,
  type StructureExtractedCrop,
} from '@ingest/contracts';

export type StructureCropMode = 'none' | 'horizontal' | 'rectangle';
export const StructureCropDraftItemSchema = StructureCropSchema.extend({
  text: z.string().max(12000),
  reviewedText: z.string().max(12000).nullable(),
  ocrDone: z.boolean(),
  confidence: z.number().min(0).max(100).nullable(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  ai: z
    .object({
      contextKey: z.string(),
      result: StructureExtractedCropSchema,
      warnings: z.array(z.string()),
    })
    .strict()
    .nullable()
    .optional(),
}).strict();
export const StructureCropDraftSchema = z
  .object({
    version: z.literal(1),
    fingerprint: z.string(),
    ordered: z.boolean(),
    crops: z.array(StructureCropDraftItemSchema).max(1000),
  })
  .strict();
export type StructureCropDraftItem = z.infer<typeof StructureCropDraftItemSchema>;
export type StructureCropDraft = z.infer<typeof StructureCropDraftSchema>;

export function reviewedStructureCropResults(
  crops: readonly StructureCropDraftItem[],
  contextKey: string,
): StructureExtractedCrop[] {
  return crops.flatMap((crop) =>
    crop.ai &&
    crop.ai.contextKey === contextKey &&
    crop.ocrDone &&
    !crop.error &&
    crop.reviewedText === crop.text &&
    crop.ai.result.text === crop.text
      ? [crop.ai.result]
      : [],
  );
}

export function cropBounds(
  mode: Exclude<StructureCropMode, 'none'>,
  start: { x: number; y: number },
  end: { x: number; y: number },
): StructureCropBounds | null {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value));
  const click = Math.abs(end.y - start.y) < 0.005;
  const box = {
    x0: mode === 'horizontal' ? 0 : clamp(Math.min(start.x, end.x)),
    x1: mode === 'horizontal' ? 1 : clamp(Math.max(start.x, end.x)),
    y0: mode === 'horizontal' && click ? 0 : clamp(Math.min(start.y, end.y)),
    y1: mode === 'horizontal' && click ? clamp(end.y) : clamp(Math.max(start.y, end.y)),
  };
  return box.x1 - box.x0 >= 0.005 && box.y1 - box.y0 >= 0.005 ? box : null;
}

export function orderStructureCrops(
  crops: readonly StructureCropDraftItem[],
): StructureCropDraftItem[] {
  return [...crops].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.bounds.y0 - b.bounds.y0 || a.bounds.x0 - b.bounds.x0,
  );
}

export function reviewedStructureText(draft: StructureCropDraft | null): StructureTextCrop[] {
  if (
    !draft?.ordered ||
    !draft.crops.length ||
    draft.crops.some(
      (crop) =>
        !crop.ocrDone ||
        crop.error !== null ||
        crop.reviewedText === null ||
        crop.reviewedText !== crop.text,
    )
  )
    return [];
  return draft.crops.map((crop) => ({
    id: crop.id,
    pageNumber: crop.pageNumber,
    text: crop.reviewedText ?? '',
  }));
}

/** Clamp translation instead of individual corners so dragging never shrinks a crop. */
export function moveCropBounds(
  bounds: StructureCropBounds,
  offset: { x: number; y: number },
): StructureCropBounds {
  const x = Math.max(-bounds.x0, Math.min(1 - bounds.x1, offset.x));
  const y = Math.max(-bounds.y0, Math.min(1 - bounds.y1, offset.y));
  return { x0: bounds.x0 + x, x1: bounds.x1 + x, y0: bounds.y0 + y, y1: bounds.y1 + y };
}

/** Text belongs to its exact image region; moving it requires fresh OCR and review. */
export function movedStructureCrop(
  crop: StructureCropDraftItem,
  bounds: StructureCropBounds,
): StructureCropDraftItem {
  if (
    crop.bounds.x0 === bounds.x0 &&
    crop.bounds.x1 === bounds.x1 &&
    crop.bounds.y0 === bounds.y0 &&
    crop.bounds.y1 === bounds.y1
  )
    return crop;
  return {
    ...crop,
    ai: null,
    bounds,
    text: '',
    reviewedText: null,
    ocrDone: false,
    confidence: null,
    warnings: [],
    error: null,
  };
}
