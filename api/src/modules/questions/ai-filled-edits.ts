import { aiFilledFields, withoutAiFields, type AiFillableField, type AiFilled, type Question, type UpdateQuestion } from '@ingest/contracts';

/**
 * The AI-filled tags after a Verify-screen edit, or undefined when they are unchanged. A tagged field whose
 * value the operator changes is no longer the AI's, so its tag is dropped; re-saving the same value (Verify
 * autosaves the whole draft) keeps it. Level is not editable on Verify, so its tag is never touched here.
 */
export function aiFilledAfterEdit(current: Question, patch: UpdateQuestion): AiFilled | null | undefined {
  const tagged = aiFilledFields(current.aiFilled);
  if (!current.aiFilled || tagged.length === 0) return undefined;
  const edited: Record<AiFillableField, boolean> = {
    topic: patch.topic !== undefined && patch.topic !== current.topic,
    answer: patch.answer !== undefined && patch.answer !== current.answer,
    solution: patch.explanation !== undefined && patch.explanation !== current.explanation,
    level: false,
    // Rebuilding the matching by hand on the verify screen makes the structure the operator's, not the AI's.
    structure: patch.match !== undefined && JSON.stringify(patch.match) !== JSON.stringify(current.match),
  };
  const drop = tagged.filter((field) => edited[field]);
  if (drop.length === 0) return undefined;
  const next = withoutAiFields(current.aiFilled, drop);
  return aiFilledFields(next).length > 0 ? next : null;
}
