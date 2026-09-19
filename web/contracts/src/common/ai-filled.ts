import { z } from 'zod';

/**
 * Provenance for question data the AI wrote: WHICH fields hold a value an AI worked out, so the team can
 * always tell machine-filled data from human-entered data. Stored on the bank row (`ai_filled`) and on its
 * staging copy (`aiFilled`), so a re-publish carries it instead of erasing it.
 *
 * A field is tagged only when its value is exactly what the AI produced and an operator approved it. It is
 * untagged again as soon as someone changes that field by hand (quality fix panel or the Verify screen) —
 * the tag never claims a human's value as the AI's.
 */
export const AI_FILLABLE_FIELDS = ['topic', 'answer', 'solution', 'level', 'structure'] as const;
export type AiFillableField = (typeof AI_FILLABLE_FIELDS)[number];

/**
 * How the value reached the question: `review` — a batch proposal approved on the Fix with AI screen;
 * `assist` — a suggestion filled into the fix panel and saved there unchanged.
 */
export const AiFillViaSchema = z.enum(['review', 'assist']);
export type AiFillVia = z.infer<typeof AiFillViaSchema>;

export const AiFillTagSchema = z.object({
  /** The model that produced the value, e.g. `gpt-5.4-mini`. */
  model: z.string(),
  /** The model's own 0–1 confidence at the time. */
  confidence: z.number().min(0).max(1),
  /** When it was written to the question (ISO). */
  at: z.string().datetime(),
  via: AiFillViaSchema,
});
export type AiFillTag = z.infer<typeof AiFillTagSchema>;

/** One tag per AI-filled field; a field that is absent was not filled by the AI. Empty = nothing was. */
export const AiFilledSchema = z.object({
  topic: AiFillTagSchema.optional(),
  answer: AiFillTagSchema.optional(),
  solution: AiFillTagSchema.optional(),
  level: AiFillTagSchema.optional(),
  /** The question's STRUCTURE: a match table, or a comprehension passage, rebuilt by the AI. */
  structure: AiFillTagSchema.optional(),
});
export type AiFilled = z.infer<typeof AiFilledSchema>;

/** The same tag set without the given fields' tags. */
export function withoutAiFields(filled: AiFilled, drop: readonly AiFillableField[]): AiFilled {
  const kept: AiFilled = {};
  for (const field of AI_FILLABLE_FIELDS) {
    const tag = filled[field];
    if (tag !== undefined && !drop.includes(field)) kept[field] = tag;
  }
  return kept;
}

/** The fields that carry a tag, in display order. */
export function aiFilledFields(filled: AiFilled | null | undefined): AiFillableField[] {
  return filled ? AI_FILLABLE_FIELDS.filter((field) => filled[field] !== undefined) : [];
}
