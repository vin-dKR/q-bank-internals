import type {
  DailyUsagePoint,
  DocumentUsage,
  SessionUsage,
  SessionUsageDetail,
  SessionUsageList,
  TokenLimit,
  TokenUsageWindow,
  UpdateTokenLimit,
  UsageAnalytics,
  UsageAnalyticsQuery,
} from '@ingest/contracts';
import { addUtcDays, startOfUtcDay, utcDayKey } from '../../shared/time/utc-day.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { SessionRepository } from '../sessions/index.js';
import type {
  RecordUsageInput,
  TokenLimitStore,
  UsageGroupRow,
  UsageRepository,
  UsageRow,
} from './usage.repository.js';

/** Trailing window (inclusive of today) the weekly cap and the "this week" headline both use. */
const WEEK_DAYS = 7;

function emptyWindow(): TokenUsageWindow {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 };
}

function addRow(window: TokenUsageWindow, row: UsageRow): TokenUsageWindow {
  return {
    promptTokens: window.promptTokens + row.promptTokens,
    completionTokens: window.completionTokens + row.completionTokens,
    totalTokens: window.totalTokens + row.totalTokens,
    callCount: window.callCount + row.callCount,
  };
}

function addGroup(window: TokenUsageWindow, group: UsageGroupRow): TokenUsageWindow {
  return {
    promptTokens: window.promptTokens + group.promptTokens,
    completionTokens: window.completionTokens + group.completionTokens,
    totalTokens: window.totalTokens + group.totalTokens,
    callCount: window.callCount + group.callCount,
  };
}

/** The later of two nullable ISO timestamps — used to roll up a group's "last used" to its parent. */
function laterIso(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

/**
 * Owns everything about token spend: recording each OpenAI call, aggregating it into the daily /
 * weekly / all-time analytics the dashboard shows, and enforcing the global budget before extraction
 * is allowed to enqueue. All windows are UTC calendar days so recording, analytics, and enforcement
 * agree on where a day begins.
 */
export class UsageService {
  constructor(
    private readonly usage: UsageRepository,
    private readonly limits: TokenLimitStore,
    private readonly sessions: SessionRepository,
    private readonly documents: DocumentRepository,
  ) {}

  /** Append one call's token spend. Best-effort: callers must not let a failure fail extraction. */
  async recordUsage(input: RecordUsageInput): Promise<void> {
    await this.usage.record(input);
  }

  /** Headline totals plus the per-day trend for the requested trailing range. */
  async getAnalytics(query: UsageAnalyticsQuery): Promise<UsageAnalytics> {
    const startOfToday = startOfUtcDay(new Date());
    const startOfWeek = addUtcDays(startOfToday, -(WEEK_DAYS - 1));
    const rangeStart = addUtcDays(startOfToday, -(query.days - 1));

    const [today, thisWeek, allTime, rows] = await Promise.all([
      this.usage.sumSince(startOfToday.toISOString()),
      this.usage.sumSince(startOfWeek.toISOString()),
      this.usage.sumAll(),
      this.usage.rowsSince(rangeStart.toISOString()),
    ]);

    return { today, thisWeek, allTime, daily: buildDailySeries(rows, rangeStart, query.days) };
  }

  /**
   * Per-session token spend, biggest eater first, plus the spend tied to no session (one-off LaTeX
   * refinement). Session labels are enriched from the session store; a since-deleted session is
   * still shown (by id) so its historical spend is never silently dropped.
   */
  async getSessionUsage(): Promise<SessionUsageList> {
    const groups = await this.usage.sumGrouped();
    const bySession = new Map<string, { window: TokenUsageWindow; documents: Set<string>; lastUsedAt: string | null }>();
    let unattributed = emptyWindow();

    for (const group of groups) {
      if (group.sessionId === null) {
        unattributed = addGroup(unattributed, group);
        continue;
      }
      const acc = bySession.get(group.sessionId) ?? { window: emptyWindow(), documents: new Set(), lastUsedAt: null };
      acc.window = addGroup(acc.window, group);
      if (group.documentId !== null) acc.documents.add(group.documentId);
      acc.lastUsedAt = laterIso(acc.lastUsedAt, group.lastUsedAt);
      bySession.set(group.sessionId, acc);
    }

    const sessions = await Promise.all(
      [...bySession.entries()].map(async ([sessionId, acc]): Promise<SessionUsage> => {
        const session = await this.sessions.findById(sessionId);
        return {
          sessionId,
          label: session?.label ?? '(deleted session)',
          ...acc.window,
          documentCount: acc.documents.size,
          lastUsedAt: acc.lastUsedAt,
        };
      }),
    );
    sessions.sort((a, b) => b.totalTokens - a.totalTokens);
    return { sessions, unattributed };
  }

  /** One session's spend drilled down to each document it extracted, biggest first. */
  async getSessionUsageDetail(sessionId: string): Promise<SessionUsageDetail> {
    const groups = (await this.usage.sumGrouped()).filter((group) => group.sessionId === sessionId);
    const [session, docs] = await Promise.all([
      this.sessions.findById(sessionId),
      this.documents.listBySession(sessionId),
    ]);
    const docNames = new Map(docs.map((doc) => [doc.id, doc]));

    let total = emptyWindow();
    let lastUsedAt: string | null = null;
    const documents: DocumentUsage[] = [];
    for (const group of groups) {
      total = addGroup(total, group);
      lastUsedAt = laterIso(lastUsedAt, group.lastUsedAt);
      if (group.documentId === null) continue;
      const doc = docNames.get(group.documentId);
      documents.push({
        documentId: group.documentId,
        fileName: doc?.fileName ?? '(deleted document)',
        questionCount: doc?.questionCount ?? 0,
        promptTokens: group.promptTokens,
        completionTokens: group.completionTokens,
        totalTokens: group.totalTokens,
        callCount: group.callCount,
        lastUsedAt: group.lastUsedAt,
      });
    }
    documents.sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      sessionId,
      label: session?.label ?? '(deleted session)',
      ...total,
      documentCount: documents.length,
      lastUsedAt,
      documents,
    };
  }

  getLimit(): Promise<TokenLimit> {
    return this.limits.get();
  }

  setLimit(input: UpdateTokenLimit): Promise<TokenLimit> {
    return this.limits.set(input);
  }

  /**
   * Gate called before a document is enqueued for extraction. Throws {@link errors.tokenLimitExceeded}
   * when today's or this week's spend has reached its cap; a `null` cap is unlimited and skipped.
   */
  async assertWithinLimit(): Promise<void> {
    const limit = await this.limits.get();
    if (limit.dailyLimit === null && limit.weeklyLimit === null) return;

    const startOfToday = startOfUtcDay(new Date());

    if (limit.dailyLimit !== null) {
      const today = await this.usage.sumSince(startOfToday.toISOString());
      if (today.totalTokens >= limit.dailyLimit) {
        throw errors.tokenLimitExceeded('daily', today.totalTokens, limit.dailyLimit);
      }
    }

    if (limit.weeklyLimit !== null) {
      const startOfWeek = addUtcDays(startOfToday, -(WEEK_DAYS - 1));
      const week = await this.usage.sumSince(startOfWeek.toISOString());
      if (week.totalTokens >= limit.weeklyLimit) {
        throw errors.tokenLimitExceeded('weekly', week.totalTokens, limit.weeklyLimit);
      }
    }
  }
}

/** Bucket rows into a zero-filled series of `days` UTC days starting at `rangeStart` (oldest first). */
function buildDailySeries(rows: UsageRow[], rangeStart: Date, days: number): DailyUsagePoint[] {
  const buckets = new Map<string, TokenUsageWindow>();
  const order: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const key = utcDayKey(addUtcDays(rangeStart, i));
    buckets.set(key, emptyWindow());
    order.push(key);
  }

  for (const row of rows) {
    const key = utcDayKey(new Date(row.createdAt));
    const bucket = buckets.get(key);
    if (bucket) buckets.set(key, addRow(bucket, row));
  }

  return order.map((date) => {
    const window = buckets.get(date) ?? emptyWindow();
    return { date, ...window };
  });
}
