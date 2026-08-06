/** A question document shaped for the main Eduents `Question` collection. */
export type BankQuestion = Record<string, unknown>;

/**
 * PORT (§3) for writing verified questions into the MAIN bank's `Question` collection. Implemented
 * with a raw Mongo insert in `infrastructure/bank` (no Prisma schema for the bank, so publishing can
 * never touch the bank's indexes), with a null-object when there is no database.
 */
export interface BankPublisher {
  insertQuestions(questions: BankQuestion[]): Promise<number>;
}
