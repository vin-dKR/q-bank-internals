const FULL = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Token counts, grouped: `1,234,567`. Used for values and tooltips. */
export function formatTokens(value: number): string {
  return FULL.format(value);
}

/** Token counts, compact: `1.2M`. Used for dense axis ticks. */
export function formatTokensCompact(value: number): string {
  return COMPACT.format(value);
}

/** A `YYYY-MM-DD` UTC day key as a short `Aug 4` label (parsed and rendered in UTC). */
export function formatDay(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
