import type { Document, SourcePath } from '@ingest/contracts';

/**
 * The sibling answer/solution source for the unit being verified: the resolved {@link Document} plus
 * the page to open it on — this topic's answer/solution start, falling back to the document's own
 * start. Used both to preview the answer/explanation PDFs and to point a field re-read at them.
 */
export type VerifySibling = {
  document: Document;
  defaultPage: number;
};

/** Two files belong to the same unit when their full module → chapter → section trail matches. */
function sameUnit(a: SourcePath, b: SourcePath): boolean {
  return a.module === b.module && a.chapter === b.chapter && a.section === b.section;
}

/**
 * The page this topic occupies in the sibling answer/solution PDF for the question on `questionPage`.
 * Reads the question document's operator-defined topic map: the type block whose question-PDF span
 * contains the page carries the matching `answerPageRange`/`solutionPageRange`. Null when no topic
 * range covers the page (legacy uploads without the v2 ranges).
 */
function topicSourcePage(
  questionDoc: Document,
  questionPage: number,
  kind: 'answer' | 'solution',
): number | null {
  for (const topic of questionDoc.topics) {
    for (const type of topic.types) {
      if (questionPage < type.pageRange.from || questionPage > type.pageRange.to) continue;
      const range = kind === 'answer' ? type.answerPageRange : type.solutionPageRange;
      if (range) return range.from;
    }
  }
  return null;
}

/**
 * Resolve the sibling answer/solution document for the unit `questionDoc` belongs to, over the
 * session's documents: the live file of the requested `kind` sharing the unit. Returns it with the
 * page to open on for the question currently on `questionPage`. Null when the unit has no such file.
 */
export function resolveSibling(
  sessionDocs: readonly Document[],
  questionDoc: Document,
  questionPage: number,
  kind: 'answer' | 'solution',
): VerifySibling | null {
  const sibling = sessionDocs.find(
    (doc) =>
      doc.id !== questionDoc.id &&
      doc.kind === kind &&
      doc.deletedAt === null &&
      sameUnit(doc.path, questionDoc.path),
  );
  if (!sibling) return null;
  const defaultPage = topicSourcePage(questionDoc, questionPage, kind) ?? sibling.pageRange?.from ?? 1;
  return { document: sibling, defaultPage };
}
