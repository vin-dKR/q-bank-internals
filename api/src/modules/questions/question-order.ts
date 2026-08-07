import type { Question } from '@ingest/contracts';

/**
 * PDF reading order for a document's questions: the printed question number where the extractor
 * read one, falling back to the question's physical place in the document (page, then top edge,
 * then left edge of its source region) when a number is missing. This — never insertion order —
 * is the order the verify screen shows and publish writes, so Q1, Q2, Q3 on the sheet stays
 * Q1, Q2, Q3 everywhere.
 */
export function compareByPdfOrder(a: Question, b: Question): number {
  if (
    a.questionNumber !== null &&
    b.questionNumber !== null &&
    a.questionNumber !== b.questionNumber
  ) {
    return a.questionNumber - b.questionNumber;
  }
  return (
    a.sourceRegion.page - b.sourceRegion.page ||
    a.sourceRegion.bbox[1] - b.sourceRegion.bbox[1] ||
    a.sourceRegion.bbox[0] - b.sourceRegion.bbox[0]
  );
}

/** A copy of `questions` sorted into PDF reading order ({@link compareByPdfOrder}). */
export function sortByPdfOrder(questions: readonly Question[]): Question[] {
  return [...questions].sort(compareByPdfOrder);
}
