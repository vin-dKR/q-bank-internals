import { z } from 'zod';

/**
 * Token spend over a time window (a calendar day, the trailing week, or all time). Sourced from the
 * `usage` object every OpenAI call returns — `prompt_tokens` / `completion_tokens` / `total_tokens` —
 * which the extraction pipeline had been discarding. `callCount` is how many model calls contributed.
 */
export const TokenUsageWindowSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  callCount: z.number().int().nonnegative(),
});
export type TokenUsageWindow = z.infer<typeof TokenUsageWindowSchema>;

/** One point in the daily trend: a UTC calendar day (`YYYY-MM-DD`) and the tokens spent that day. */
export const DailyUsagePointSchema = TokenUsageWindowSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type DailyUsagePoint = z.infer<typeof DailyUsagePointSchema>;

/**
 * The Usage dashboard payload: headline totals for today / the trailing week / all time, plus the
 * per-day series that drives the trend chart. Windows use UTC calendar-day boundaries throughout, so
 * the same definition backs both the analytics here and the enforced limits.
 */
export const UsageAnalyticsSchema = z.object({
  today: TokenUsageWindowSchema,
  thisWeek: TokenUsageWindowSchema,
  allTime: TokenUsageWindowSchema,
  daily: z.array(DailyUsagePointSchema),
});
export type UsageAnalytics = z.infer<typeof UsageAnalyticsSchema>;

/** How many trailing UTC days of daily series to return for the trend chart. */
export const UsageAnalyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export type UsageAnalyticsQuery = z.infer<typeof UsageAnalyticsQuerySchema>;

/** Token spend attributed to one session — how much that upload run "ate", with its call breakdown. */
export const SessionUsageSchema = TokenUsageWindowSchema.extend({
  sessionId: z.string(),
  label: z.string(),
  documentCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type SessionUsage = z.infer<typeof SessionUsageSchema>;

/** Per-session totals plus the spend that belongs to no session (e.g. one-off LaTeX refinement). */
export const SessionUsageListSchema = z.object({
  sessions: z.array(SessionUsageSchema),
  unattributed: TokenUsageWindowSchema,
});
export type SessionUsageList = z.infer<typeof SessionUsageListSchema>;

/** Token spend for one document within a session, with the question count needed for per-question metrics. */
export const DocumentUsageSchema = TokenUsageWindowSchema.extend({
  documentId: z.string(),
  fileName: z.string(),
  questionCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type DocumentUsage = z.infer<typeof DocumentUsageSchema>;

/** One session's usage broken down to each document it extracted — the drill-down view. */
export const SessionUsageDetailSchema = SessionUsageSchema.extend({
  documents: z.array(DocumentUsageSchema),
});
export type SessionUsageDetail = z.infer<typeof SessionUsageDetailSchema>;

/**
 * The global, editable token budget. A `null` cap means "no limit on that window". Enforced before a
 * document is enqueued for extraction: exceeding either cap blocks new runs until usage rolls off the
 * window or an operator raises the cap.
 */
export const TokenLimitSchema = z.object({
  dailyLimit: z.number().int().positive().nullable(),
  weeklyLimit: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime(),
});
export type TokenLimit = z.infer<typeof TokenLimitSchema>;

/** Body accepted when setting the budget. `null` clears a cap; omit a field to leave it unchanged. */
export const UpdateTokenLimitSchema = z
  .object({
    dailyLimit: z.number().int().positive().nullable(),
    weeklyLimit: z.number().int().positive().nullable(),
  })
  .partial();
export type UpdateTokenLimit = z.infer<typeof UpdateTokenLimitSchema>;
