import type { JSX } from 'react';
import type { TokenUsageWindow, UsageAnalytics } from '@ingest/contracts';
import { formatTokens } from '../lib/format-tokens.js';

type Tile = { label: string; window: TokenUsageWindow };

/** Headline token totals for today, the trailing week, and all time — three KPI tiles. */
export function UsageStats({ analytics }: { analytics: UsageAnalytics }): JSX.Element {
  const tiles: Tile[] = [
    { label: 'Today', window: analytics.today },
    { label: 'This week', window: analytics.thisWeek },
    { label: 'All time', window: analytics.allTime },
  ];

  return (
    <div className="kpi-row">
      {tiles.map((tile) => (
        <div key={tile.label} className="kpi">
          <span className="kpi__label">{tile.label}</span>
          <span className="kpi__value">{formatTokens(tile.window.totalTokens)}</span>
          <span className="muted">
            {formatTokens(tile.window.callCount)} calls ·{' '}
            {formatTokens(tile.window.promptTokens)} in / {formatTokens(tile.window.completionTokens)} out
          </span>
        </div>
      ))}
    </div>
  );
}
