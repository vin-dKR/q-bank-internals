import type { Question } from '@ingest/contracts';
import { optionLabelKey } from './option-labels.js';

/** Reviewing a source image requires that the same complete crop is still the rendered field. */
export function chemistrySourceReviewBlockers(question: Pick<Question,
  'chemistry' | 'stem' | 'options' | 'questionImage' | 'isQuestionImage' | 'optionImages' | 'isOptionImage'
>): string[] {
  const chemistry = question.chemistry;
  if (!chemistry || chemistry.visuals.length === 0) return ['No chemistry source crops are available.'];
  const blockers: string[] = [];
  for (const visual of chemistry.visuals) {
    const label = visual.field === 'stem' ? 'Question' : `Option ${visual.optionLabel ?? '?'}`;
    if (!visual.cropUrl?.trim()) {
      blockers.push(`${label}: source crop is missing.`);
      continue;
    }
    if (visual.field === 'stem') {
      if (!question.isQuestionImage || question.questionImage !== visual.cropUrl || question.stem.trim()) {
        blockers.push(`${label}: the complete source crop must be the question field.`);
      }
    } else {
      const index = question.options.findIndex((option) => optionLabelKey(option.label) === optionLabelKey(visual.optionLabel ?? ''));
      if (index < 0 || !question.isOptionImage || question.optionImages[index] !== visual.cropUrl || question.options[index]?.body.trim()) {
        blockers.push(`${label}: the complete source crop must be assigned to this choice.`);
      }
    }
  }
  return [...new Set(blockers)];
}
