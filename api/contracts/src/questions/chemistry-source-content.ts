import type { Passage, Question } from './question.schema.js';

type SourceQuestion = Pick<Question,
  'chemistry' | 'stem' | 'options' | 'answer' | 'explanation' | 'isQuestionImage' | 'questionImage' |
  'isOptionImage' | 'optionImages' | 'answerImages' | 'explanationImages' | 'match' | 'passageId'
>;
type SourcePassage = Pick<Passage, 'text' | 'passageImage'>;
const MOLECULAR_TAG = /<smiles\b/i;

/** Keep readable wording and reaction conditions while the preserved diagram carries connectivity. */
export function chemistrySourceText(text: string): string {
  return text.replace(/<smiles\b[^>]*>[\s\S]*?(?:<\/smiles\s*>|$)/gi, '[See source diagram]').trim();
}

export function chemistrySourceOptionText(text: string, label: string): string {
  const match = /^\s*(?:\(\s*([^()]+?)\s*\)|([A-Za-z0-9]+)\s*[.)])\s*([\s\S]*)$/u.exec(text);
  const sourceLabel = match?.[1] ?? match?.[2];
  return chemistrySourceText(sourceLabel?.trim().toUpperCase() === label.trim().toUpperCase() ? match?.[3] ?? '' : text);
}

function labelKey(label: string): string {
  return label.trim().replace(/^[([{\s]+|[)\]}.:\s]+$/gu, '').toLocaleLowerCase();
}

function agreesWithSourceText(text: string, candidate: string): boolean {
  // Blank legacy fields remain supported; new extractions retain their readable text.
  return !text.trim() || text.trim() === chemistrySourceText(candidate);
}

/** One shared preflight for the Verify button and the server's acceptance/publication guard. */
export function chemistrySourceReviewIssues(question: SourceQuestion, passage?: SourcePassage | null): string[] {
  const chemistry = question.chemistry;
  if (!chemistry) return [];
  const issues: string[] = [];
  if (MOLECULAR_TAG.test(question.stem)) issues.push('The question stem still renders an unverified molecular candidate; restore its source diagrams.');
  for (const option of question.options) {
    if (MOLECULAR_TAG.test(option.body)) issues.push(`Option ${option.label} still renders an unverified molecular candidate; restore its source diagram.`);
  }
  if (MOLECULAR_TAG.test(question.answer)) issues.push('The answer still renders an unverified molecular candidate; restore its source diagram.');
  if (MOLECULAR_TAG.test(question.explanation ?? '')) issues.push('The worked solution still renders an unverified molecular candidate; restore its source diagrams.');
  for (const column of question.match?.columns ?? []) {
    if (MOLECULAR_TAG.test(column.title)) issues.push('A matrix column heading still contains an unverified molecular candidate.');
    for (const entry of column.entries) {
      if (MOLECULAR_TAG.test(entry.body)) issues.push(`Matrix entry ${entry.label} still renders an unverified molecular candidate; replace its complete field with a source image.`);
    }
  }
  if (question.passageId !== null) {
    if (!passage) issues.push('The shared chemistry passage is missing and cannot be reviewed.');
    else if (MOLECULAR_TAG.test(passage.text)) issues.push('The shared passage still renders an unverified molecular candidate; replace its complete text with a source image.');
    else if (!passage.text.trim() && !passage.passageImage?.trim()) issues.push('The shared chemistry passage has neither readable text nor an authoritative source image.');
  }
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const visual of chemistry.visuals) {
    if (!visual.id.trim() || ids.has(visual.id)) issues.push('A source visual has a missing or duplicate identity.');
    ids.add(visual.id);
    const owner = visual.field === 'option' ? `option:${labelKey(visual.optionLabel ?? '')}` : visual.field;
    if (owners.has(owner) && (visual.field === 'stem' || visual.field === 'option')) issues.push('More than one source crop claims the same complete field.');
    owners.add(owner);
    const cropUrl = visual.cropUrl?.trim();
    if (!cropUrl) { issues.push('A chemistry source crop has not been uploaded.'); continue; }
    if (visual.field !== 'option' && visual.optionLabel !== null) issues.push('A non-option source crop incorrectly owns an option label.');
    if (visual.field === 'stem') {
      if (!question.isQuestionImage || question.questionImage?.trim() !== cropUrl) issues.push('The complete stem source crop must be the single question image.');
      if (!agreesWithSourceText(question.stem, chemistry.candidateStem)) issues.push('The question text changed from the preserved source transcription; restore it before source review.');
    } else if (visual.field === 'option') {
      const label = visual.optionLabel;
      const matches = label === null ? [] : question.options.flatMap((option, index) => labelKey(option.label) === labelKey(label) ? [index] : []);
      const index = matches[0];
      if (matches.length !== 1 || index === undefined) { issues.push(`Source option ${label ?? '?'} no longer maps to exactly one printed choice.`); continue; }
      const option = question.options[index];
      if (!question.isOptionImage || question.optionImages[index]?.trim() !== cropUrl) issues.push(`Source option ${label ?? '?'} is not attached at its printed choice position.`);
      if (option && option.body.trim() && option.body.trim() !== chemistrySourceOptionText(chemistry.candidateOptions[index] ?? '', option.label)) issues.push(`The text for option ${option.label} changed from its preserved source transcription.`);
    } else {
      const images = visual.field === 'answer' ? question.answerImages : question.explanationImages;
      if (!images.some((url) => url.trim() === cropUrl)) issues.push(`The ${visual.field === 'answer' ? 'answer' : 'worked solution'} source crop is not attached to its field.`);
    }
  }
  for (const field of ['answer', 'explanation'] as const) {
    const candidate = field === 'answer' ? chemistry.candidateAnswer : chemistry.candidateExplanation;
    if (chemistry.unresolvedSourceFields?.includes(field) || (candidate && MOLECULAR_TAG.test(candidate) && !chemistry.visuals.some((visual) => visual.field === field && visual.cropUrl))) {
      issues.push(`The ${field === 'answer' ? 'answer' : 'worked solution'} is missing its preserved source diagram. Restore chemistry content before review.`);
    }
  }
  return [...new Set(issues)];
}
