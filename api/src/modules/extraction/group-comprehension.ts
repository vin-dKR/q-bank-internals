import { createHash } from 'node:crypto';
import type { NewPassage } from '../questions/index.js';
import type { ExtractedQuestion } from './vision-extractor.js';

/** Annotated drafts (each comprehension member stamped with its passageId + order) + the passage rows. */
export type MaterializedPassages = {
  drafts: ExtractedQuestion[];
  passages: NewPassage[];
};

/**
 * Normalize a comprehension block into ONE shared passage per group plus its sub-question rows (BLA-125,
 * v2), WITHOUT copying the passage text onto every sibling.
 *
 * A comprehension paper prints a passage followed by several sub-questions. The extractor returns one
 * draft per sub-question, each tagged with the same verbatim `passage`. This dedups the drafts that
 * share a passage into a single {@link NewPassage} row (keyed by the normalized passage text, with a
 * deterministic id), and annotates each member draft with that row's `passageId` and a sequential
 * 0-based `groupOrder`. The passage TEXT lives once on the passage row — a single edit in verify is
 * atomic, and siblings can never drift.
 *
 * Runs AFTER the answer merge so each sub-question already carries its own answer/explanation. Drafts
 * without a passage (every non-comprehension question) pass through with `passageId`/`groupOrder` null
 * and produce no passage row. The count and order of drafts are unchanged — this stamps, never collapses.
 */
export function materializePassages(
  drafts: ExtractedQuestion[],
  documentId: string,
): MaterializedPassages {
  // First-seen passage row per normalized passage, and a running per-group order.
  const byKey = new Map<string, NewPassage>();
  const order = new Map<string, number>();
  const annotated = drafts.map((draft) => {
    const passage = (draft.passage ?? '').trim();
    if (passage.length === 0) return { ...draft, passageId: null, groupOrder: null };
    const key = passageKey(passage);
    let row = byKey.get(key);
    if (!row) {
      row = {
        id: makeGroupId(documentId, key),
        documentId,
        text: passage, // first-seen verbatim passage, stored ONCE
        contentHash: createHash('sha1').update(key).digest('hex'),
        passageImage: null, // the operator attaches the shared figure later, in verify
        imageCrops: [],
      };
      byKey.set(key, row);
    }
    const groupOrder = order.get(key) ?? 0;
    order.set(key, groupOrder + 1);
    return { ...draft, passageId: row.id, groupOrder };
  });
  return { drafts: annotated, passages: [...byKey.values()] };
}

/** Normalize a passage so trivially-different whitespace/case still groups its sub-questions together. */
function passageKey(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A stable passage/group id: a hash of the document id + the normalized passage. Deterministic —
 * re-extracting or re-publishing the same document yields the same id for the same passage, so the
 * group's identity survives across runs, the passage image attached in verify re-associates, and the
 * bank upsert (which stamps this as group_id) stays idempotent.
 */
function makeGroupId(documentId: string, key: string): string {
  return createHash('sha1').update(`${documentId}\n${key}`).digest('hex').slice(0, 24);
}
