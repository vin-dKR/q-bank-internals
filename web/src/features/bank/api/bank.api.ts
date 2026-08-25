import { z } from 'zod';
import { BankQuestionSchema, type BankQuestion } from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

const BankQuestionListSchema = z.array(BankQuestionSchema);

/** The only place the bank-search feature hits the network. */
export const bankApi = {
  search: (q: string, limit = 20): Promise<BankQuestion[]> => {
    const query = new URLSearchParams({ q, limit: String(limit) });
    return request(`/bank/questions?${query.toString()}`, { schema: BankQuestionListSchema });
  },
};
