import { AppError } from '../../shared/errors/app-error.js';
import type { BankPublisher } from '../../modules/publish/index.js';

/** Null-object {@link BankPublisher} for the in-memory dev driver — publishing needs a real database. */
export class UnconfiguredBankPublisher implements BankPublisher {
  insertQuestions(): Promise<number> {
    return Promise.reject(
      new AppError('PUBLISH_UNAVAILABLE', 400, 'Publishing requires DB_DRIVER=mongo + DATABASE_URL.'),
    );
  }
}
