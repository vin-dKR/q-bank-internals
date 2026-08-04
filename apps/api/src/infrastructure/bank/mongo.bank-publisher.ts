import type { Prisma, PrismaClient } from '@prisma/client';
import type { BankPublisher, BankQuestion } from '../../modules/publish/index.js';

/**
 * {@link BankPublisher} that inserts into the main bank's `Question` collection with a RAW Mongo
 * command over the shared connection. Deliberately raw (not a Prisma model) so publishing can never
 * alter the bank's schema or indexes — it only appends documents.
 */
export class MongoBankPublisher implements BankPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly collection = 'Question',
  ) {}

  async insertQuestions(questions: BankQuestion[]): Promise<number> {
    if (questions.length === 0) return 0;
    const command = {
      insert: this.collection,
      documents: questions,
    } as unknown as Prisma.InputJsonObject;
    const result = (await this.prisma.$runCommandRaw(command)) as { n?: number };
    return result.n ?? questions.length;
  }
}
