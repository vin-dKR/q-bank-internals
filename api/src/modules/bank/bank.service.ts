import type { BankQuestion, UpdateBankImage } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { BankQuestionStore } from './bank.repository.js';

/**
 * Read + fix side of the MAIN bank: search published questions and re-point one question/option
 * image at a freshly cropped URL. The one place that repairs live bank data after publishing.
 */
export class BankService {
  constructor(private readonly bank: BankQuestionStore) {}

  search(text: string, limit: number): Promise<BankQuestion[]> {
    return this.bank.search(text, limit);
  }

  /** Re-point the question figure or one option image (identified by ingest `questionId`). */
  async updateImage(questionId: string, patch: UpdateBankImage): Promise<BankQuestion> {
    if (patch.target === 'question') {
      return this.bank.patchImages(questionId, { isQuestionImage: true, questionImage: patch.url });
    }
    if (patch.optionIndex === null) {
      throw errors.validation({ message: 'optionIndex is required to fix an option image.' });
    }
    const current = await this.bank.findByQuestionId(questionId);
    if (!current) throw errors.bankQuestionNotFound(questionId);
    const optionImages = [...current.optionImages];
    while (optionImages.length <= patch.optionIndex) optionImages.push('');
    optionImages[patch.optionIndex] = patch.url;
    return this.bank.patchImages(questionId, { isOptionImage: true, optionImages });
  }
}
