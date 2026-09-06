import { createHash } from 'node:crypto';
import type { ExtractedQuestion } from './vision-extractor.js';

/**
 * Annotate comprehension sub-questions that share a passage into a GROUP (BLA-125), WITHOUT collapsing
 * them.
 *
 * A comprehension paper prints a passage followed by several sub-questions. The extractor returns one
 * draft per sub-question, each tagged with the same verbatim `passage`. This used to fold every group
 * that shares a passage into ONE flat question (passage + inline renumbered sub-questions), which
 * destroyed the structure — the printed numbers, the per-sub-question options/answer/explanation, and
 * any way to render the passage once above its questions. Instead, this now KEEPS every sub-question as
 * its own draft and stamps each with a shared {@link ExtractedQuestion.groupId} and a sequential
 * {@link ExtractedQuestion.groupOrder}, and canonicalizes the `passage` to the group's first verbatim
 * passage so every sibling row is byte-identical.
 *
 * The result is N drafts (unchanged in count and order) that a downstream renderer can group by
 * `groupId` to show the passage once, while a flat renderer that ignores the new fields still shows N
 * self-contained questions (each carries the passage). Runs AFTER the answer merge so each
 * sub-question already carries its own answer/explanation. Drafts without a passage (every
 * non-comprehension question) pass through untouched with `groupId`/`groupOrder` left null.
 */
export function groupComprehensionDrafts(
  drafts: ExtractedQuestion[],
  documentId: string,
): ExtractedQuestion[] {
  // First-seen canonical passage + stable groupId per normalized passage, and a running per-group order.
  const canonical = new Map<string, { passage: string; groupId: string }>();
  const order = new Map<string, number>();
  return drafts.map((draft) => {
    const passage = (draft.passage ?? '').trim();
    if (passage.length === 0) return draft;
    const key = passageKey(passage);
    let meta = canonical.get(key);
    if (!meta) {
      meta = { passage, groupId: makeGroupId(documentId, key) };
      canonical.set(key, meta);
    }
    const groupOrder = order.get(key) ?? 0;
    order.set(key, groupOrder + 1);
    // Canonicalize the passage to the group's first, so every sibling row stores the identical text.
    return { ...draft, passage: meta.passage, groupId: meta.groupId, groupOrder };
  });
}

/** Normalize a passage so trivially-different whitespace/case still groups its sub-questions together. */
function passageKey(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A stable group id: a hash of the document id + the normalized passage. Deterministic — re-extracting
 * or re-publishing the same document yields the same groupId for the same passage, so the group's
 * identity survives across runs and the bank upsert stays idempotent.
 */
function makeGroupId(documentId: string, key: string): string {
  return createHash('sha1').update(`${documentId}\n${key}`).digest('hex').slice(0, 24);
}
