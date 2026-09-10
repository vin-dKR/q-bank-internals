import type { BankPassageResult, BankQuestion, BankTextResult, UpdateBankImage, UpdateBankText } from '@ingest/contracts';
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

  /** Set/clear the flag on a published question (browse "Flag" toggle), keyed by its bank `_id`. */
  async setFlag(id: string, flagged: boolean): Promise<{ id: string; flagged: boolean }> {
    return { id, flagged: await this.bank.setFlag(id, flagged) };
  }

  /**
   * Persist an AI-fixed text field (stem/options/answer) on a published question, keyed by its bank
   * `_id`. Echoes the applied patch back so the browse card can reconcile its optimistic update.
   */
  async setText(id: string, patch: UpdateBankText): Promise<BankTextResult> {
    await this.bank.setText(id, patch);
    return { id, ...patch };
  }

  /**
   * Permanently delete a published question from the main bank (the Questions-browse "Delete"), keyed
   * by its bank `_id`. Echoes the removed id back so the browse can drop it from its cached pages.
   */
  async deleteQuestion(id: string): Promise<{ id: string; deleted: true }> {
    await this.bank.deleteById(id);
    return { id, deleted: true };
  }

  /**
   * Rewrite the shared comprehension passage text across every row of a group (keyed by its
   * `group_id`). Echoes the group id, the persisted text, and how many sibling rows changed.
   */
  async setPassage(groupId: string, passage: string): Promise<BankPassageResult> {
    const updated = await this.bank.setPassage(groupId, passage);
    return { groupId, passage, updated };
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
