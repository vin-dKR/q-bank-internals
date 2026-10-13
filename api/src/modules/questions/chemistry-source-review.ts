import { isDeepStrictEqual } from 'node:util';
import { chemistrySourceReviewIssues, type Passage, type Question, type UpdateQuestion } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';

export { chemistrySourceReviewIssues } from '@ingest/contracts';

/** Source provenance is extractor-owned; only acceptance can be changed by a review update. */
export function chemistryReviewPatch(
  current: Question,
  patch: UpdateQuestion,
  passage?: Pick<Passage, 'text' | 'passageImage'> | null,
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
    answerImages: patch.answerImages ?? current.answerImages,
    explanationImages: patch.explanationImages ?? current.explanationImages,
    match: patch.match === undefined ? current.match : patch.match,
    passageId: current.passageId,
  }, passage);
  if (issues.length === 0) return {};
  if (patch.chemistry?.status === 'source_preserved') throw errors.chemistryReviewInvalid(issues.join(' '));
  // Ordinary edits remain possible, but changed ownership invalidates the earlier review.
  return { chemistry: { ...chemistry, status: 'needs_review' } };
}
