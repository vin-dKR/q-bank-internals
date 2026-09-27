/** A question document shaped for the main Eduents `Question` collection. */
export type BankQuestion = Record<string, unknown>;

/**
 * PORT (§3) for writing verified questions into the MAIN bank's `Question` collection. Implemented
 * with a raw Mongo upsert in `infrastructure/bank` (no Prisma schema for the bank, so publishing can
 * never touch the bank's indexes), with a null-object when there is no database.
 *
 * The write is idempotent: each row is upserted on its `ingest_ref.question_id`, so re-publishing a
 * document updates its existing bank rows instead of creating duplicates. Unchanged rows are skipped;
 * changed fields are patched, preserving bank-only fields. Returns the number of rows written
 * (updated or inserted); the implementation throws on any partial or failed write.
 */
export interface BankPublisher {
  upsertQuestions(questions: BankQuestion[]): Promise<number>;
}
