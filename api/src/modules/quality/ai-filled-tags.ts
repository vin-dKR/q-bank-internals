import {
  AI_FILLABLE_FIELDS,
  QuestionLevelSchema,
  type AiFillClaim,
  type AiFillVia,
  type AiFillableField,
  type AiFilled,
  type QuestionFix,
  withoutAiFields,
} from '@ingest/contracts';
import type { AuditQuestion } from './quality.types.js';

/** The value a fix writes to one AI-fillable field; undefined when the fix leaves that field alone. */
function fixValue(fix: QuestionFix, field: AiFillableField): string | null | undefined {
  switch (field) {
    case 'topic':
      return fix.topic;
    case 'answer':
      return fix.answer;
    case 'solution':
      return fix.explanation;
    case 'level':
      return fix.level;
    case 'structure':
      // One value for the pair, so a rebuilt table or passage compares like any other field.
      return fix.match === undefined && fix.passage === undefined
        ? undefined
        : JSON.stringify({ match: fix.match ?? null, passage: fix.passage ?? null });
  }
}

/** What the question holds for that field before the fix. */
function currentValue(question: AuditQuestion, field: AiFillableField): string | null {
  switch (field) {
    case 'topic':
      return question.topic;
    case 'answer':
      return question.answer;
    case 'solution':
      return question.explanation;
    case 'level':
      return QuestionLevelSchema.safeParse(question.level).data ?? null;
    case 'structure':
      return JSON.stringify({ match: question.match, passage: question.passage });
  }
}

/** Who is writing: the AI's claim on some fields (with where it came from), or nobody's (a manual edit). */
export type AiFillSource = { claim: AiFillClaim; via: AiFillVia } | null;

/**
 * The question's AI-filled tags after a fix, or undefined when they do not change (so nothing is written).
 * Per field the fix touches:
 *
 * - claimed by the AI and actually filled in with a new value → tagged with the model, confidence and time;
 * - changed to anything else (a manual edit, or cleared) → untagged, because the value is no longer the AI's;
 * - written with the value it already had → left as it was. Re-saving a form must not erase provenance,
 *   and an AI "confirming" a value a human entered does not make it AI-filled.
 */
export function nextAiFilled(question: AuditQuestion, fix: QuestionFix, source: AiFillSource, at: Date): AiFilled | undefined {
  const tagged: AiFilled = {};
  const untagged: AiFillableField[] = [];
  for (const field of AI_FILLABLE_FIELDS) {
    const value = fixValue(fix, field);
    if (value === undefined || value === currentValue(question, field)) continue;
    const claimed = source !== null && source.claim.fields.includes(field) && value !== null && value.trim() !== '';
    if (claimed) {
      tagged[field] = { model: source.claim.model, confidence: source.claim.confidence, at: at.toISOString(), via: source.via };
    } else if (question.aiFilled[field] !== undefined) {
      untagged.push(field);
    }
  }
  if (Object.keys(tagged).length === 0 && untagged.length === 0) return undefined;
  return { ...withoutAiFields(question.aiFilled, untagged), ...tagged };
}
