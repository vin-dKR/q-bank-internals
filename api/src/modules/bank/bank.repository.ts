import type { BankQuestion } from '@ingest/contracts';

/** The image columns the fix flow may re-point on a published bank question. */
export type BankImagePatch = {
  isQuestionImage?: boolean;
  questionImage?: string;
  isOptionImage?: boolean;
  optionImages?: string[];
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
}
