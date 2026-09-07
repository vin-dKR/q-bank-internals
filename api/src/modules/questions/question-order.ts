import type { Question } from '@ingest/contracts';

/** Base PDF-reading-order key for a single question: printed number, then page, then bbox top, then left. */
function baseKey(question: Question): [number, number, number, number] {
  return [
    question.questionNumber ?? Number.MAX_SAFE_INTEGER,
    question.sourceRegion.page,
    question.sourceRegion.bbox[1],
    question.sourceRegion.bbox[0],
  ];
}

/** Lexicographic compare of two numeric keys. */
function compareKey(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * PDF reading order for a document's questions. A question's place is its printed number, falling back
 * to its physical position (page, then bbox top, then left) when a number is missing — this, never
 * insertion order, is what verify shows and publish writes, so Q1, Q2, Q3 on the sheet stays Q1, Q2, Q3.
 *
 * A comprehension group (rows sharing a `passageId`) is kept CONTIGUOUS: every member sorts at the
 * group's EARLIEST member position, then by `groupOrder`. This holds even when the operator manually
 * grouped non-adjacent questions — the whole block stays together here (so verify renders ONE card) and
 * in the published bank order (so the consumer's consecutive-row fold shows the passage once).
 */
export function sortByPdfOrder(questions: readonly Question[]): Question[] {
  // The anchor (earliest base key) of each group, so all its members cluster at that position.
  const anchorByPassage = new Map<string, [number, number, number, number]>();
  for (const question of questions) {
    if (question.passageId === null) continue;
    const key = baseKey(question);
    const current = anchorByPassage.get(question.passageId);
    if (!current || compareKey(key, current) < 0) anchorByPassage.set(question.passageId, key);
  }
  const primaryKey = (question: Question): number[] =>
    question.passageId !== null ? anchorByPassage.get(question.passageId) ?? baseKey(question) : baseKey(question);

  return [...questions].sort((a, b) => {
    const byGroupAnchor = compareKey(primaryKey(a), primaryKey(b));
    if (byGroupAnchor !== 0) return byGroupAnchor;
    // Same anchor position → members of the same group (order by groupOrder), or a standalone question
    // that happens to tie the anchor member — fall back to its own base key for a stable order.
    if (a.passageId !== null && a.passageId === b.passageId) {
      return (a.groupOrder ?? 0) - (b.groupOrder ?? 0);
    }
    return compareKey(baseKey(a), baseKey(b));
  });
}
