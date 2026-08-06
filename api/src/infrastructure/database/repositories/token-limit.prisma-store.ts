import type { PrismaClient } from '@prisma/client';
import type { TokenLimit } from '@ingest/contracts';
import type { SetTokenLimitInput, TokenLimitStore } from '../../../modules/usage/index.js';

type LimitRow = { dailyLimit: number | null; weeklyLimit: number | null; updatedAt: Date };

function toLimit(row: LimitRow): TokenLimit {
  return {
    dailyLimit: row.dailyLimit,
    weeklyLimit: row.weeklyLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The budget before any cap has been set: unlimited, epoch timestamp. */
function unset(): TokenLimit {
  return { dailyLimit: null, weeklyLimit: null, updatedAt: new Date(0).toISOString() };
}

/**
 * Production adapter for {@link TokenLimitStore}, backed by MongoDB via Prisma. The budget is a single
 * row: `get` reads it (or the unlimited default), `set` upserts it in place.
 */
export class PrismaTokenLimitStore implements TokenLimitStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<TokenLimit> {
    const row = await this.prisma.tokenLimit.findFirst();
    return row ? toLimit(row) : unset();
  }

  async set(input: SetTokenLimitInput): Promise<TokenLimit> {
    const existing = await this.prisma.tokenLimit.findFirst();
    if (existing) {
      const row = await this.prisma.tokenLimit.update({
        where: { id: existing.id },
        data: {
          ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
          ...(input.weeklyLimit !== undefined ? { weeklyLimit: input.weeklyLimit } : {}),
        },
      });
      return toLimit(row);
    }
    const row = await this.prisma.tokenLimit.create({
      data: { dailyLimit: input.dailyLimit ?? null, weeklyLimit: input.weeklyLimit ?? null },
    });
    return toLimit(row);
  }
}
