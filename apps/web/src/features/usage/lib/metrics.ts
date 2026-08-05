import type { TokenUsageWindow } from '@ingest/contracts';

/** Average tokens per model call — how large each request runs. 0 when there were no calls. */
export function tokensPerCall(window: TokenUsageWindow): number {
  return window.callCount === 0 ? 0 : Math.round(window.totalTokens / window.callCount);
}

/** Share of spend that was input (prompt + image) vs output, as a percentage. */
export function promptSharePct(window: TokenUsageWindow): number {
  return window.totalTokens === 0 ? 0 : Math.round((window.promptTokens / window.totalTokens) * 100);
}

/** Tokens spent per extracted question — the efficiency of a document's extraction. */
export function tokensPerQuestion(totalTokens: number, questionCount: number): number {
  return questionCount === 0 ? 0 : Math.round(totalTokens / questionCount);
}
