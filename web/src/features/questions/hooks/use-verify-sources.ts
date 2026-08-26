import { useMemo } from 'react';
import type { Document } from '@ingest/contracts';
import { useDocuments } from '../../documents/index.js';
import { resolveSibling, type VerifySibling } from '../lib/verify-sources.js';

/** The unit's sibling answer/solution sources for the verify screen (either absent for the unit). */
export type VerifySources = { answer: VerifySibling | null; solution: VerifySibling | null };

/**
 * Resolve the sibling answer/solution documents for the unit `questionDoc` belongs to — over the
 * documents of its session — each with the page to open for the question currently on `questionPage`.
 * A document with no session has no siblings, and the lookup issues no unscoped all-documents fetch.
 */
export function useVerifySources(
  questionDoc: Document | undefined,
  questionPage: number,
): VerifySources {
  const sessionId = questionDoc?.sessionId ?? null;
  const docs = useDocuments(sessionId ? { sessionId } : {}, { enabled: sessionId !== null });
  const items = docs.data?.items;
  return useMemo(() => {
    if (!questionDoc || !items) return { answer: null, solution: null };
    return {
      answer: resolveSibling(items, questionDoc, questionPage, 'answer'),
      solution: resolveSibling(items, questionDoc, questionPage, 'solution'),
    };
  }, [items, questionDoc, questionPage]);
}
