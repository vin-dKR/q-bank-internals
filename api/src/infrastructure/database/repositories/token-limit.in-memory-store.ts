import type { TokenLimit } from '@ingest/contracts';
import type { SetTokenLimitInput, TokenLimitStore } from '../../../modules/usage/index.js';

/** Dev/test adapter for {@link TokenLimitStore}. The single budget row lives in memory. */
export class InMemoryTokenLimitStore implements TokenLimitStore {
  private limit: TokenLimit = {
    dailyLimit: null,
    weeklyLimit: null,
    updatedAt: new Date(0).toISOString(),
  };

  get(): Promise<TokenLimit> {
    return Promise.resolve(this.limit);
  }

  set(input: SetTokenLimitInput): Promise<TokenLimit> {
    this.limit = {
      dailyLimit: input.dailyLimit !== undefined ? input.dailyLimit : this.limit.dailyLimit,
      weeklyLimit: input.weeklyLimit !== undefined ? input.weeklyLimit : this.limit.weeklyLimit,
      updatedAt: new Date().toISOString(),
    };
    return Promise.resolve(this.limit);
  }
}
