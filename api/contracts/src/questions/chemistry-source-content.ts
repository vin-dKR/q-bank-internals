import type { Passage, Question } from './question.schema.js';

type SourceQuestion = Pick<Question,
  'chemistry' | 'stem' | 'options' | 'answer' | 'explanation' | 'isQuestionImage' | 'questionImage' |
  'isOptionImage' | 'optionImages' | 'answerImages' | 'explanationImages' | 'match' | 'passageId'
>;
type SourcePassage = Pick<Passage, 'text' | 'passageImage'>;
const MOLECULAR_TAG = /<smiles\b/i;
const MOLECULAR_TOKEN = /<smiles\s*>([\s\S]*?)<\/smiles\s*>/giu;

/** Keep readable wording and reaction conditions while the preserved diagram carries connectivity. */
export function chemistrySourceText(text: string): string {
  return text.replace(/<smiles\b[^>]*>[\s\S]*?(?:<\/smiles\s*>|$)/gi, '[See source diagram]').trim();
}

export function chemistrySourceOptionText(text: string, label: string): string {
  return chemistrySourceText(chemistryTranscriptionOptionText(text, label));
}

export function chemistryTranscriptionOptionText(text: string, label: string): string {
  const match = /^\s*(?:\(\s*([^()]+?)\s*\)|([A-Za-z0-9]+)\s*[.)])\s*([\s\S]*)$/u.exec(text);
  const sourceLabel = match?.[1] ?? match?.[2];
  return (sourceLabel?.trim().toUpperCase() === label.trim().toUpperCase() ? match?.[3] ?? '' : text).trim();
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
  if (chemistry.representation === 'transcription') return transcriptionReviewIssues(question, passage);
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

/** Rendered molecular tokens from every chemistry-bearing field, including shared passages. */
export function chemistryRenderedMolecules(question: SourceQuestion, passage?: SourcePassage | null): Array<{ field: string; smiles: string }> {
  const fields = [
    { field: 'stem', text: question.stem },
    ...question.options.map((option) => ({ field: `option ${option.label}`, text: option.body })),
    { field: 'answer', text: question.answer },
    { field: 'explanation', text: question.explanation ?? '' },
    ...(question.match?.columns.flatMap((column) => [
      { field: 'matrix heading', text: column.title },
      ...column.entries.map((entry) => ({ field: `matrix entry ${entry.label}`, text: entry.body })),
    ]) ?? []),
    ...(passage ? [{ field: 'passage', text: passage.text }] : []),
  ];
  return fields.flatMap(({ field, text }) => [...text.matchAll(MOLECULAR_TOKEN)].map((match) => ({ field, smiles: (match[1] ?? '').trim() })));
}

function transcriptionReviewIssues(question: SourceQuestion, passage?: SourcePassage | null): string[] {
  const chemistry = question.chemistry;
  if (!chemistry) return [];
  const issues: string[] = [];
  const fields = [
    { label: 'Question', text: question.stem, manualImage: Boolean(question.isQuestionImage && question.questionImage?.trim()) },
    ...question.options.map((option, index) => ({ label: `Option ${option.label}`, text: option.body, manualImage: Boolean(question.isOptionImage && question.optionImages[index]?.trim()) })),
    { label: 'Answer', text: question.answer, manualImage: question.answerImages.some((url) => url.trim()) },
    { label: 'Worked solution', text: question.explanation ?? '', manualImage: question.explanationImages.some((url) => url.trim()) },
    ...(question.match?.columns.flatMap((column) => [
      { label: 'Matrix heading', text: column.title, manualImage: false },
      ...column.entries.map((entry) => ({ label: `Matrix entry ${entry.label}`, text: entry.body, manualImage: Boolean(entry.image?.trim()) })),
    ]) ?? []),
    ...(passage ? [{ label: 'Shared passage', text: passage.text, manualImage: Boolean(passage.passageImage?.trim()) }] : []),
  ];
  for (const { label, text, manualImage } of fields) {
    const tokens = [...text.matchAll(MOLECULAR_TOKEN)];
    const openings = [...text.matchAll(/<smiles\b/giu)];
    const closings = [...text.matchAll(/<\/smiles\b/giu)];
    if (openings.length !== tokens.length || closings.length !== tokens.length || tokens.some((match) => !(match[1] ?? '').trim())) {
      issues.push(`${label}: an incomplete or empty SMILES tag needs correction.`);
    }
    if (/\[See source diagram\]/iu.test(text)) issues.push(`${label}: the saved extraction still contains a source-diagram placeholder. Restore the extracted SMILES.`);
    if (/\[Unresolved molecular structure\b|Connectivity\/stereochemistry of the drawn structure is image-dependent/iu.test(text) && !manualImage) {
      issues.push(`${label}: an unresolved molecular structure needs correction or a manual source crop in this field.`);
    }
  }
  if (question.passageId !== null && !passage) issues.push('The shared chemistry passage is missing and cannot be reviewed.');
  else if (question.passageId !== null && passage && !passage.text.trim() && !passage.passageImage?.trim()) issues.push('The shared chemistry passage needs readable text or a manual source crop before review.');
  const owners = new Map<string, { count: number; text: string; manualImage: boolean; manualCount: number; label: string }>();
  for (const visual of chemistry.visuals) {
    const index = visual.field === 'option' ? question.options.findIndex((option) => labelKey(option.label) === labelKey(visual.optionLabel ?? '')) : -1;
    const owner = visual.field === 'option' ? `option:${labelKey(visual.optionLabel ?? '')}` : visual.field;
    const text = visual.field === 'stem' ? [question.stem, passage?.text ?? '', ...(question.match?.columns.flatMap((column) => [column.title, ...column.entries.map((entry) => entry.body)]) ?? [])].join('\n') : visual.field === 'answer' ? question.answer : visual.field === 'explanation' ? question.explanation ?? '' : question.options[index]?.body ?? '';
    const label = visual.field === 'stem' ? 'Question' : visual.field === 'option' ? `Option ${visual.optionLabel ?? '?'}` : visual.field === 'answer' ? 'Answer' : 'Worked solution';
    const manualImage = visual.field === 'stem' ? Boolean(question.isQuestionImage && question.questionImage?.trim())
      : visual.field === 'option' ? Boolean(question.isOptionImage && question.optionImages[index]?.trim())
      : visual.field === 'answer' ? question.answerImages.some((url) => url.trim()) : question.explanationImages.some((url) => url.trim());
    const prior = owners.get(owner);
    const manualCount = visual.field === 'stem' ? (passage?.passageImage?.trim() ? 1 : 0) + (question.match?.columns.flatMap((column) => column.entries.filter((entry) => entry.image?.trim())).length ?? 0) : 0;
    owners.set(owner, { text, manualImage, manualCount, label, count: (prior?.count ?? 0) + (visual.moleculeCount ?? Math.max(visual.candidateSmiles.length, visual.kind === 'figure' ? 0 : 1)) });
  }
  for (const field of ['answer', 'explanation'] as const) {
    const count = chemistry.sourceMoleculeCounts?.[field];
    if (count === undefined) continue;
    const prior = owners.get(field);
    const text = field === 'answer' ? question.answer : question.explanation ?? '';
    const manualImage = (field === 'answer' ? question.answerImages : question.explanationImages).some((url) => url.trim());
    owners.set(field, { text, manualImage, manualCount: 0, label: field === 'answer' ? 'Answer' : 'Worked solution', count: Math.max(prior?.count ?? 0, count) });
  }
  for (const { count, text, manualImage, manualCount, label } of owners.values()) {
    const emitted = [...text.matchAll(MOLECULAR_TOKEN)].length;
    if (emitted + manualCount < count && !manualImage) issues.push(`${label}: ${emitted} of ${count} inventoried molecules are transcribed. Reread this field or add a manual source crop as a last resort.`);
  }
  return [...new Set(issues)];
}
