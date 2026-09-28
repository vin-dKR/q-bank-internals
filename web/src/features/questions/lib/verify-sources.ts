import type { Document, SourcePath } from '@ingest/contracts';

type AnswerMaterialKind = 'answer' | 'solution' | 'companion';

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
 * A new upload receives one client-minted group id shared by its question and supporting PDFs. That
 * id is the authoritative pairing when it is present — two separately uploaded copies of the same
 * chapter must never borrow each other's answer key. Older rows have no group id, so retain the
 * historical path-based pairing for those legacy uploads.
 */
function sameUpload(questionDoc: Document, candidate: Document): boolean {
  if (!sameUnit(questionDoc.path, candidate.path)) return false;
  return !questionDoc.uploadGroupId || !candidate.uploadGroupId || questionDoc.uploadGroupId === candidate.uploadGroupId;
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
  kind: AnswerMaterialKind,
): number | null {
  for (const topic of questionDoc.topics) {
    for (const type of topic.types) {
      if (questionPage < type.pageRange.from || questionPage > type.pageRange.to) continue;
      const range = kind === 'answer'
        ? type.answerPageRange
        : kind === 'solution'
          ? type.solutionPageRange
          : type.companionPageRange;
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
  // An inline paper is self-contained. In particular, do not accidentally point its field controls
  // at an old Answer/Solution upload from the same session.
  if (questionDoc.answerLayout === 'inline') return null;
  const sourceKind: AnswerMaterialKind = questionDoc.answerLayout === 'combined' ? 'companion' : kind;
  const sibling = sessionDocs.find(
    (doc) =>
      doc.id !== questionDoc.id &&
      doc.kind === sourceKind &&
      doc.deletedAt === null &&
      doc.sessionId === questionDoc.sessionId &&
      sameUpload(questionDoc, doc),
  );
  if (!sibling) return null;
  const defaultPage = topicSourcePage(questionDoc, questionPage, sourceKind) ?? sibling.pageRange?.from ?? 1;
  return { document: sibling, defaultPage };
}
