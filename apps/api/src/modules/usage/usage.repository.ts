import type { TokenLimit, TokenUsageWindow } from '@ingest/contracts';

/**
 * The token spend an AI adapter reports back from one or more OpenAI calls — the honest output of a
 * model invocation, before it is attributed to a document/session. Shared by the extractor and the
 * LaTeX refiner (the two OpenAI callers) so the "usage produced" shape is defined once.
 */
export type AiTokenUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
};

/** One recorded usage row: the AI spend attributed to a source (`extraction`/`latex`) and document. */
export type RecordUsageInput = AiTokenUsage & {
  source: string;
  documentId?: string | null;
  sessionId?: string | null;
};

/** A usage row trimmed to what the daily-series bucketer needs (bounded to the chart range). */
export type UsageRow = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
  createdAt: string;
};

/**
 * Spend aggregated by its (session, document) attribution — the raw material the service folds into
 * per-session and per-document breakdowns. `lastUsedAt` is the latest row in the group; either id is
 * `null` for spend not tied to a session/document (e.g. one-off LaTeX refinement).
 */
export type UsageGroupRow = TokenUsageWindow & {
  sessionId: string | null;
  documentId: string | null;
  lastUsedAt: string;
};

/**
 * Persistence PORT for recorded token usage (§3). `sum*` push aggregation into the driver (cheap,
 * unbounded windows); `rowsSince` returns raw rows only for the bounded chart range so the service
 * can bucket them into UTC days without the driver needing date arithmetic.
 */
export interface UsageRepository {
  record(input: RecordUsageInput): Promise<void>;
  /** Summed spend for rows at or after `fromIso`. */
  sumSince(fromIso: string): Promise<TokenUsageWindow>;
  /** Summed spend across every row. */
  sumAll(): Promise<TokenUsageWindow>;
  /** Raw rows at or after `fromIso`, for the daily trend series. */
  rowsSince(fromIso: string): Promise<UsageRow[]>;
  /** All spend, aggregated per (session, document) — folded into the session/document breakdowns. */
  sumGrouped(): Promise<UsageGroupRow[]>;
}

/** Fields accepted when editing the budget — `null` clears a cap, `undefined` leaves it unchanged. */
export type SetTokenLimitInput = {
  dailyLimit?: number | null | undefined;
  weeklyLimit?: number | null | undefined;
};

/**
 * Persistence PORT for the single global token budget (§3). `get` returns the current caps (both
 * `null` when unset); `set` upserts the one row. Shape matches the contract `TokenLimit`.
 */
export interface TokenLimitStore {
  get(): Promise<TokenLimit>;
  set(input: SetTokenLimitInput): Promise<TokenLimit>;
}
