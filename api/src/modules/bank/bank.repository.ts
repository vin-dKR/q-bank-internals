import type { BankQuestion, MatchData } from '@ingest/contracts';

/** The image columns the fix flow may re-point on a published bank question. */
export type BankImagePatch = {
  isQuestionImage?: boolean;
  questionImage?: string;
  isOptionImage?: boolean;
  optionImages?: string[];
};

/**
 * The content columns the inline editor / AI-fix flow may overwrite on a published bank question
 * (any subset). Each is explicitly `| undefined` so the zod-inferred `UpdateBankText` (whose optional
 * fields carry undefined) flows straight in under `exactOptionalPropertyTypes`; the store applies only
 * the fields that are set. `match` maps to the bank's `match_columns` + `match_key` pair.
 */
export type BankTextPatch = {
  questionText?: string | undefined;
  options?: string[] | undefined;
  answer?: string | null | undefined;
  explanation?: string | null | undefined;
  match?: MatchData | null | undefined;
};

/**
 * PORT (§3) for reading and lightly patching the MAIN bank's already-published `Question` collection
 * — the read/fix counterpart to publish's write-only {@link BankPublisher}. Keyed by the ingest
 * `questionId` (the stable id stamped on `ingest_ref` at publish), never the Mongo `_id`. Implemented
 * with raw Mongo in `infrastructure/bank` (the bank has no Prisma schema), null-object for the dev driver.
 */
export interface BankQuestionStore {
  /** Published questions whose text or file name matches `text` (case-insensitive), newest-agnostic. */
  search(text: string, limit: number): Promise<BankQuestion[]>;
  /** The published question stamped with this ingest `questionId`, or null when none is. */
  findByQuestionId(questionId: string): Promise<BankQuestion | null>;
  /** Re-point image columns on the question stamped with `questionId`; returns the updated row. */
  patchImages(questionId: string, patch: BankImagePatch): Promise<BankQuestion>;
  /**
   * Set/clear the `flagged` mark on a published question, keyed by its bank Mongo `_id` (what the
   * browse card carries), so it works for legacy rows that never got an `ingest_ref`. Returns the
   * persisted flag state.
   */
  setFlag(id: string, flagged: boolean): Promise<boolean>;
  /**
   * Overwrite the stem/options/answer text on a published question, keyed by its bank Mongo `_id`
   * (what the browse card carries), so it works for legacy rows with no `ingest_ref`. Throws when no
   * row matches; the caller has already validated the patch carries at least one field.
   */
  setText(id: string, patch: BankTextPatch): Promise<void>;
  /**
   * Rewrite the shared comprehension passage text on EVERY row of a group, keyed by its `group_id`
   * (the denormalized id every sibling row carries). The passage is repeated identically across the
   * group, so all its rows update together. Returns how many rows changed; throws when none match.
   */
  setPassage(groupId: string, passage: string): Promise<number>;
  /**
   * Delete the published question(s) stamped with this ingest `questionId` — called when a staged
   * question is deleted in verify, so its live bank copy goes too. Idempotent: returns how many rows
   * were removed (0 when the question was never published).
   */
  deleteByQuestionId(questionId: string): Promise<number>;
  /**
   * Permanently delete the published question with this bank Mongo `_id` (what the browse card carries)
   * — the Questions-browse "Delete" action. Keyed by `_id` like {@link setFlag}/{@link setText}, so it
   * works for legacy rows with no `ingest_ref`. Throws when no row matches (the card always carries a
   * live id, so a miss is a genuine error, not an idempotent no-op like the verify delete above).
   */
  deleteById(id: string): Promise<void>;
}
