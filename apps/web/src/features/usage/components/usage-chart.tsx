import type { JSX } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyUsagePoint } from '@ingest/contracts';
import { formatDay, formatTokens, formatTokensCompact } from '../lib/format-tokens.js';

/** Tooltip payload for one day's bar — the day plus its token/call breakdown. */
function ChartTooltip({ active, payload }: TooltipProps<number, string>): JSX.Element | null {
  const entry = active ? payload?.[0] : undefined;
  if (!entry) return null;
  // Recharts types the datum as `any`; it is the `DailyUsagePoint` we fed `BarChart`.
  const day = entry.payload as DailyUsagePoint;
  return (
    <div className="usage-chart__tip">
      <strong>{formatDay(day.date)}</strong>
      <span>{formatTokens(day.totalTokens)} tokens</span>
      <span className="muted">
        {formatTokens(day.callCount)} calls · {formatTokens(day.promptTokens)} in /{' '}
        {formatTokens(day.completionTokens)} out
      </span>
    </div>
  );
}

/**
 * Daily token spend over the selected window. One series (title names it, so no legend); thin bars
 * anchored to the baseline, recessive grid/axes, and a per-bar hover tooltip.
 */
export function UsageChart({ daily }: { daily: DailyUsagePoint[] }): JSX.Element {
  return (
    <div className="usage-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            tick={{ fill: 'var(--text-subtle)', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-strong)' }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={formatTokensCompact}
            tick={{ fill: 'var(--text-subtle)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip cursor={{ fill: 'var(--accent-soft)' }} content={<ChartTooltip />} />
          <Bar dataKey="totalTokens" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
