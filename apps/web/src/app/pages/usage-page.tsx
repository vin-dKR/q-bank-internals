import { type JSX, useState } from 'react';
import { PageHeader } from '../../shared/ui/index.js';
import {
  LimitForm,
  LimitProgress,
  SessionUsageTable,
  UsageChart,
  UsageStats,
  useTokenLimit,
  useUsageAnalytics,
} from '../../features/usage/index.js';

const RANGES = [7, 30, 90] as const;

/** Token usage dashboard: daily/weekly/all-time totals, a daily trend, and the global budget. */
export function UsagePage(): JSX.Element {
  const [days, setDays] = useState<number>(30);
  const analytics = useUsageAnalytics(days);
  const limit = useTokenLimit();

  return (
    <section className="page">
      <PageHeader
        title="Token usage"
        subtitle="OpenAI tokens spent by extraction and LaTeX refinement, and the global budget that caps them."
        actions={
          <label className="field--inline">
            <span className="field__label">Range</span>
            <select
              value={days}
              style={{ width: 'auto' }}
              onChange={(e) => { setDays(Number(e.target.value)); }}
            >
              {RANGES.map((option) => (
                <option key={option} value={option}>Last {option} days</option>
              ))}
            </select>
          </label>
        }
      />

      {analytics.isPending ? (
        <p className="muted">Loading usage…</p>
      ) : analytics.isError ? (
        <p className="error">Could not reach the API. Is it running on :4000?</p>
      ) : (
        <div className="usage-layout">
          <UsageStats analytics={analytics.data} />

          <div className="card">
            <div className="card__title">Daily tokens · last {days} days</div>
            <UsageChart daily={analytics.data.daily} />
          </div>

          <div className="card">
            <div className="card__title">By session · which run ate how much</div>
            <p className="muted">
              Click a session to break its spend down per document — tokens per call, prompt vs
              completion split, and tokens per extracted question.
            </p>
            <SessionUsageTable />
          </div>

          <div className="usage-budget">
            <div className="card">
              <div className="card__title">Budget usage</div>
              {limit.data ? (
                <LimitProgress analytics={analytics.data} limit={limit.data} />
              ) : (
                <p className="muted">Loading budget…</p>
              )}
            </div>

            <div className="card">
              <div className="card__title">Set budget</div>
              {limit.data ? <LimitForm limit={limit.data} /> : <p className="muted">Loading…</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
