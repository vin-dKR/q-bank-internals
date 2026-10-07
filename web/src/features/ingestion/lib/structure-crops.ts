import { z } from 'zod';
import {
  StructureCropSchema,
  StructureExtractedCropSchema,
  StructureCropRoleSchema,
  type StructureCropBounds,
  type StructureTextCrop,
  type StructureExtractedCrop,
  type StructureCropRole,
} from '@ingest/contracts';

export type StructureCropMode = 'none' | 'horizontal' | 'rectangle';
export const StructureCropSizeSchema = z
  .object({
    width: z.number().finite().min(0.005).max(1),
    height: z.number().finite().min(0.005).max(1),
  })
  .strict();
export type StructureCropSize = z.infer<typeof StructureCropSizeSchema>;
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
    lockedSizes: z.record(StructureCropRoleSchema, StructureCropSizeSchema).optional(),
  })
  .strict();
export type StructureCropDraftItem = z.infer<typeof StructureCropDraftItemSchema>;
export type StructureCropDraft = z.infer<typeof StructureCropDraftSchema>;

export function lockStructureCropSize(draft: StructureCropDraft, id: string): StructureCropDraft {
  const crop = draft.crops.find((item) => item.id === id);
  if (!crop) return draft;
  return {
    ...draft,
    lockedSizes: {
      ...draft.lockedSizes,
      [crop.role ?? 'combined']: {
        width: crop.bounds.x1 - crop.bounds.x0,
        height: crop.bounds.y1 - crop.bounds.y0,
      },
    },
  };
}

export function unlockStructureCropSize(
  draft: StructureCropDraft,
  role: StructureCropRole,
): StructureCropDraft {
  if (!draft.lockedSizes?.[role]) return draft;
  const lockedSizes = Object.fromEntries(
    Object.entries(draft.lockedSizes).filter(([id]) => id !== role),
  );
  return { ...draft, lockedSizes };
}

/** Clamp the position, preserving the saved size even when the pointer is near a page edge. */
export function placeLockedStructureCrop(
  size: StructureCropSize,
  point: { x: number; y: number },
): StructureCropBounds {
  const x0 = Math.max(0, Math.min(1 - size.width, point.x));
  const y0 = Math.max(0, Math.min(1 - size.height, point.y));
  return { x0, y0, x1: x0 + size.width, y1: y0 + size.height };
}

/** Save a whole generation in one draft update, preserving results for unchanged image/text roles. */
export function saveStructureCropResults(
  draft: StructureCropDraft,
  results: readonly StructureExtractedCrop[],
  contextKey: string,
  warnings: readonly string[],
): StructureCropDraft {
  const byId = new Map(results.map((result) => [result.cropId, result]));
  return {
    ...draft,
    crops: draft.crops.map((crop) => {
      const result = byId.get(crop.id);
      return result &&
        crop.ocrDone &&
        !crop.error &&
        crop.text === result.text &&
        (crop.role ?? 'combined') === (result.role ?? 'combined')
        ? { ...crop, ai: { result, contextKey, warnings: [...warnings] } }
        : crop;
    }),
  };
}

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
    crop.ai.result.text === crop.text &&
    (crop.ai.result.role ?? 'combined') === (crop.role ?? 'combined')
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
    ...(crop.role ? { role: crop.role } : {}),
  }));
}

/** The image is unchanged, but previous AI classification no longer matches the operator's role. */
export function retypedStructureCrop(
  crop: StructureCropDraftItem,
  role: StructureCropRole,
): StructureCropDraftItem {
  return (crop.role ?? 'combined') === role
    ? crop
    : { ...crop, role, reviewedText: null, ai: null };
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
