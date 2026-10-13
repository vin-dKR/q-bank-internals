import { chemistrySourceOptionText, chemistrySourceText, type ChemistryExtraction, type Question } from '@ingest/contracts';
import { optionLabelKey } from './option-labels.js';

/** Legacy blank fields read their saved transcription only while the matching source crop exists. */
export function chemistryResultText(
  question: Pick<Question, 'chemistry' | 'options'>,
  field: ChemistryExtraction['visuals'][number]['field'],
  text: string,
  optionIndex?: number,
): string {
  const chemistry = question.chemistry;
  if (!chemistry) return text;
  const option = optionIndex === undefined ? undefined : question.options[optionIndex];
  const sourceOwned = chemistry.visuals.some((visual) => visual.field === field && Boolean(visual.cropUrl?.trim())
    && (field !== 'option' || (option && optionLabelKey(visual.optionLabel ?? '') === optionLabelKey(option.label))));
  const candidate = field === 'stem' ? chemistry.candidateStem
    : field === 'answer' ? chemistry.candidateAnswer
    : field === 'explanation' ? chemistry.candidateExplanation
    : optionIndex === undefined ? undefined : chemistry.candidateOptions[optionIndex];
  const readable = text.trim() ? text : sourceOwned ? candidate ?? '' : '';
  return option ? chemistrySourceOptionText(readable, option.label) : chemistrySourceText(readable);
}
