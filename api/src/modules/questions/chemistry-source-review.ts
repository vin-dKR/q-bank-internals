import { isDeepStrictEqual } from 'node:util';
import type { Passage, Question, UpdateQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';

type ChemistrySourceQuestion = Pick<Question,
  'chemistry' | 'stem' | 'options' | 'answer' | 'explanation' | 'isQuestionImage' | 'questionImage' | 'isOptionImage' | 'optionImages' | 'match' | 'passageId'
>;
type ChemistrySourcePassage = Pick<Passage, 'text' | 'passageImage'>;
const MOLECULAR_TAG = /<smiles\b/i;

function optionLabelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

/** A reviewed source crop is authoritative only while it occupies its complete original field. */
export function chemistrySourceReviewIssues(
  question: ChemistrySourceQuestion,
  passage?: ChemistrySourcePassage | null,
): string[] {
  const chemistry = question.chemistry;
  if (!chemistry) return [];
  const issues: string[] = [];
  if (MOLECULAR_TAG.test(question.stem)) issues.push('The question stem still renders an unverified molecular candidate; replace its complete field with a source image.');
  for (const option of question.options) {
    if (MOLECULAR_TAG.test(option.body)) issues.push(`Option ${option.label} still renders an unverified molecular candidate; replace its complete field with a source image.`);
  }
  if (MOLECULAR_TAG.test(question.answer)) issues.push('The answer still renders an unverified molecular candidate; replace the candidate with its source image before review.');
  if (MOLECULAR_TAG.test(question.explanation ?? '')) issues.push('The worked solution still renders an unverified molecular candidate; replace the candidate with its source image before review.');
  for (const column of question.match?.columns ?? []) {
    if (MOLECULAR_TAG.test(column.title)) issues.push('A matrix column heading still contains an unverified molecular candidate.');
    for (const entry of column.entries) {
      // The table renderer displays both body and image. Attaching a crop does not suppress a guessed
      // molecular graph; the complete source fallback must remove that candidate from the body.
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
    const owner = visual.field === 'stem' ? 'stem' : `option:${optionLabelKey(visual.optionLabel ?? '')}`;
    if (owners.has(owner)) issues.push('More than one source crop claims the same complete field.');
    owners.add(owner);
    const cropUrl = visual.cropUrl?.trim();
    if (!cropUrl) {
      issues.push('A chemistry source crop has not been uploaded.');
      continue;
    }
    if (visual.field === 'stem') {
      if (visual.optionLabel !== null) issues.push('A stem source crop incorrectly owns an option label.');
      if (!question.isQuestionImage || question.questionImage?.trim() !== cropUrl) issues.push('The complete stem source crop must be the single question image.');
      if (question.stem.trim()) issues.push('A complete stem source crop must replace its candidate text.');
      continue;
    }
    const optionLabel = visual.optionLabel;
    if (optionLabel === null || !optionLabel.trim()) {
      issues.push('A chemistry option source crop has no printed option label.');
      continue;
    }
    const matches = question.options.flatMap((option, index) => optionLabelKey(option.label) === optionLabelKey(optionLabel) ? [index] : []);
    const index = matches[0];
    if (matches.length !== 1 || index === undefined) {
      issues.push(`Source option ${optionLabel} no longer maps to exactly one printed choice.`);
      continue;
    }
    if (!question.isOptionImage || question.optionImages[index]?.trim() !== cropUrl) {
      issues.push(`Source option ${optionLabel} is not attached at its printed choice position.`);
    }
    if (question.options[index]?.body.trim()) issues.push(`The complete option ${optionLabel} source crop must replace its candidate text.`);
  }
  return [...new Set(issues)];
}

/**
 * Review can change acceptance only. Source identity, crop provenance, and candidate diagnostics are
 * extractor-owned; allowing clients to remove that ledger would bypass the publication gate.
 */
export function chemistryReviewPatch(
  current: Question,
  patch: UpdateQuestion,
  passage?: ChemistrySourcePassage | null,
): Pick<UpdateQuestion, 'chemistry'> {
  if (patch.chemistry !== undefined) {
    if (current.chemistry === null) {
      if (patch.chemistry !== null) throw errors.chemistryReviewInvalid('This question has no extracted chemistry source ledger to review.');
    } else if (patch.chemistry === null || !isDeepStrictEqual(
      { ...current.chemistry, status: 'needs_review' },
      { ...patch.chemistry, status: 'needs_review' },
    )) {
      throw errors.chemistryReviewInvalid('Source visuals and candidate diagnostics cannot be removed or rewritten by an acceptance update.');
    }
  }
  const chemistry = patch.chemistry === undefined ? current.chemistry : patch.chemistry;
  if (!chemistry || chemistry.status !== 'source_preserved') return {};
  const issues = chemistrySourceReviewIssues({
    chemistry,
    stem: patch.stem ?? current.stem,
    options: patch.options ?? current.options,
    answer: patch.answer ?? current.answer,
    explanation: patch.explanation === undefined ? current.explanation : patch.explanation,
    isQuestionImage: patch.isQuestionImage ?? current.isQuestionImage,
    questionImage: patch.questionImage === undefined ? current.questionImage : patch.questionImage,
    isOptionImage: patch.isOptionImage ?? current.isOptionImage,
    optionImages: patch.optionImages ?? current.optionImages,
    match: patch.match === undefined ? current.match : patch.match,
    passageId: current.passageId,
  }, passage);
  if (issues.length === 0) return {};
  if (patch.chemistry?.status === 'source_preserved') throw errors.chemistryReviewInvalid(issues.join(' '));
  // Ordinary edits remain possible, but changed image ownership invalidates the earlier review.
  return { chemistry: { ...chemistry, status: 'needs_review' } };
}
