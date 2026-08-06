import { z } from 'zod';
import { BankQuestionSchema, type BankQuestion, type UpdateBankImage } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const BankQuestionListSchema = z.array(BankQuestionSchema);

/** The only place the bank-fix feature hits the network. `questionId` is the ingest question id. */
export const bankApi = {
  search: (q: string, limit = 20): Promise<BankQuestion[]> => {
    const query = new URLSearchParams({ q, limit: String(limit) });
    return request(`/bank/questions?${query.toString()}`, { schema: BankQuestionListSchema });
  },

  updateImage: (questionId: string, patch: UpdateBankImage): Promise<BankQuestion> =>
    request(`/bank/questions/${questionId}/image`, {
      method: 'PATCH',
      body: patch,
      schema: BankQuestionSchema,
    }),
};
