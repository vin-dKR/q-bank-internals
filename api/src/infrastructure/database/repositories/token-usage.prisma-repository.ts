import type { PrismaClient } from '@prisma/client';
import type { TokenUsageWindow } from '@ingest/contracts';
import type {
  RecordUsageInput,
  UsageGroupRow,
  UsageRepository,
  UsageRow,
} from '../../../modules/usage/index.js';

type SumAggregate = {
  _sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    callCount: number | null;
  };
};

function toWindow(aggregate: SumAggregate): TokenUsageWindow {
  return {
    promptTokens: aggregate._sum.promptTokens ?? 0,
    completionTokens: aggregate._sum.completionTokens ?? 0,
    totalTokens: aggregate._sum.totalTokens ?? 0,
    callCount: aggregate._sum.callCount ?? 0,
  };
}

/** Production adapter for {@link UsageRepository}, backed by MongoDB via Prisma. */
export class PrismaUsageRepository implements UsageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: RecordUsageInput): Promise<void> {
    await this.prisma.tokenUsage.create({
      data: {
        source: input.source,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        callCount: input.callCount,
        documentId: input.documentId ?? null,
        sessionId: input.sessionId ?? null,
      },
    });
  }

  async sumSince(fromIso: string): Promise<TokenUsageWindow> {
    const aggregate = await this.prisma.tokenUsage.aggregate({
      where: { createdAt: { gte: new Date(fromIso) } },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, callCount: true },
    });
    return toWindow(aggregate);
  }

  async sumAll(): Promise<TokenUsageWindow> {
    const aggregate = await this.prisma.tokenUsage.aggregate({
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, callCount: true },
    });
    return toWindow(aggregate);
  }

  async rowsSince(fromIso: string): Promise<UsageRow[]> {
    const rows = await this.prisma.tokenUsage.findMany({
      where: { createdAt: { gte: new Date(fromIso) } },
      select: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        callCount: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      callCount: row.callCount,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async sumGrouped(): Promise<UsageGroupRow[]> {
    const groups = await this.prisma.tokenUsage.groupBy({
      by: ['sessionId', 'documentId'],
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, callCount: true },
      _max: { createdAt: true },
    });
    return groups.map((group) => ({
      sessionId: group.sessionId,
      documentId: group.documentId,
      promptTokens: group._sum.promptTokens ?? 0,
      completionTokens: group._sum.completionTokens ?? 0,
      totalTokens: group._sum.totalTokens ?? 0,
      callCount: group._sum.callCount ?? 0,
      lastUsedAt: (group._max.createdAt ?? new Date(0)).toISOString(),
    }));
  }
}
