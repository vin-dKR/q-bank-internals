import type { JSX } from 'react';
import type { TokenLimit, UsageAnalytics } from '@ingest/contracts';
import { IconWarning } from '../../../shared/ui/index.js';
import { formatTokens } from '../lib/format-tokens.js';

type Tone = 'ok' | 'near' | 'over';

function toneFor(used: number, cap: number): Tone {
  if (used >= cap) return 'over';
  return used / cap >= 0.8 ? 'near' : 'ok';
}

/** One cap's usage bar: `used / cap` with a fill width and a tone that flags near/over budget. */
function LimitBar({ label, used, cap }: { label: string; used: number; cap: number | null }): JSX.Element {
  if (cap === null) {
    return (
      <div className="limit-bar">
        <div className="limit-bar__head">
          <span>{label}</span>
          <span className="muted">No cap</span>
        </div>
        <div className="limit-bar__track" />
      </div>
    );
  }

  const tone = toneFor(used, cap);
  const pct = Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="limit-bar">
      <div className="limit-bar__head">
        <span>{label}</span>
        <span className="muted">
          {formatTokens(used)} / {formatTokens(cap)} ({pct}%)
        </span>
      </div>
      <div className="limit-bar__track">
        <div className={`limit-bar__fill limit-bar__fill--${tone}`} style={{ width: `${String(pct)}%` }} />
      </div>
      {tone === 'over' ? (
        <span className="limit-bar__flag">
          <IconWarning /> Over budget — new extractions are blocked.
        </span>
      ) : null}
    </div>
  );
}

/** Today's and this week's spend against their caps, so an operator sees headroom at a glance. */
export function LimitProgress({
  analytics,
  limit,
}: {
  analytics: UsageAnalytics;
  limit: TokenLimit;
}): JSX.Element {
  return (
    <div className="limit-progress">
      <LimitBar label="Daily" used={analytics.today.totalTokens} cap={limit.dailyLimit} />
      <LimitBar label="Weekly" used={analytics.thisWeek.totalTokens} cap={limit.weeklyLimit} />
    </div>
  );
}
