import type { KNOWN_QUESTION_TYPES } from '@ingest/contracts';

/**
 * Human labels for the controlled question-type vocabulary. One mapping, consumed by every surface
 * that shows a question's type (the browse card's type badge, the verify preview) so a type reads the
 * same word everywhere instead of a raw `single_correct` slug. Typed over {@link KNOWN_QUESTION_TYPES}
 * so adding a known type forces a label here; a custom (non-known) type falls back to title-case.
 */
const KNOWN_LABELS: Record<(typeof KNOWN_QUESTION_TYPES)[number], string> = {
  single_correct: 'Single correct',
  multi_correct: 'Multiple correct',
  integer: 'Integer',
  matrix: 'Matrix match',
  comprehension: 'Comprehension',
  assertion_reason: 'Assertion & reason',
  true_false: 'True / false',
  fill_blank: 'Fill in the blank',
  subjective: 'Subjective',
};

/** Title-case an unknown snake_case type ("only_one_correct" → "Only One Correct"). */
function titleCase(type: string): string {
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** The display label for a question type, or null when the question carries no type. */
export function questionTypeLabel(type: string | null | undefined): string | null {
  if (!type || !type.trim()) return null;
  return (KNOWN_LABELS as Record<string, string>)[type] ?? titleCase(type);
}
