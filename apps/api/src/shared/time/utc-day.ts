const MS_PER_DAY = 86_400_000;

/** Midnight (00:00:00.000) of the UTC calendar day that `instant` falls in. */
export function startOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/** `day` shifted by whole UTC days. Safe for arithmetic because UTC has no DST. */
export function addUtcDays(day: Date, delta: number): Date {
  return new Date(day.getTime() + delta * MS_PER_DAY);
}

/** The `YYYY-MM-DD` key of an instant's UTC calendar day — the bucket key for the daily series. */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
