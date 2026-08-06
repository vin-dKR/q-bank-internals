import type { BankQuestion } from '@ingest/contracts';
import { AppError } from '../../shared/errors/app-error.js';
import type { BankQuestionStore } from '../../modules/bank/index.js';

/**
 * Null-object {@link BankQuestionStore} for the in-memory dev driver — the bank needs a real database.
 * Search returns nothing (so the fix screen renders empty rather than erroring); fixing fails loudly.
 */
export class UnconfiguredBankQuestionStore implements BankQuestionStore {
  search(): Promise<BankQuestion[]> {
    return Promise.resolve([]);
  }

  findByQuestionId(): Promise<BankQuestion | null> {
    return Promise.resolve(null);
  }

  patchImages(): Promise<BankQuestion> {
    return Promise.reject(
      new AppError('BANK_UNAVAILABLE', 400, 'The question bank requires DB_DRIVER=mongo + DATABASE_URL.'),
    );
  }
}
