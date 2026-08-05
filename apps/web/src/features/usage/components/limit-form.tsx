import { type JSX, useState } from 'react';
import type { TokenLimit } from '@ingest/contracts';
import { useSetTokenLimit } from '../hooks/use-usage.js';

/** Parse a cap input: blank means "no cap" (null); otherwise the entered positive integer. */
function parseCap(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function toField(cap: number | null): string {
  return cap === null ? '' : String(cap);
}

/** Edit the global daily / weekly token caps. Blank clears a cap. Saves via the usage endpoint. */
export function LimitForm({ limit }: { limit: TokenLimit }): JSX.Element {
  const [daily, setDaily] = useState(toField(limit.dailyLimit));
  const [weekly, setWeekly] = useState(toField(limit.weeklyLimit));
  const setLimit = useSetTokenLimit();

  return (
    <form
      className="limit-form"
      onSubmit={(event) => {
        event.preventDefault();
        setLimit.mutate({ dailyLimit: parseCap(daily), weeklyLimit: parseCap(weekly) });
      }}
    >
      <label className="field">
        <span className="field__label">Daily cap (tokens)</span>
        <input
          type="number"
          min={1}
          step={1}
          placeholder="No limit"
          value={daily}
          onChange={(e) => { setDaily(e.target.value); }}
        />
      </label>
      <label className="field">
        <span className="field__label">Weekly cap (tokens)</span>
        <input
          type="number"
          min={1}
          step={1}
          placeholder="No limit"
          value={weekly}
          onChange={(e) => { setWeekly(e.target.value); }}
        />
      </label>
      <button type="submit" className="btn btn--primary" disabled={setLimit.isPending}>
        {setLimit.isPending ? 'Saving…' : 'Save budget'}
      </button>
      {setLimit.isError ? <p className="error">{setLimit.error.message}</p> : null}
      {setLimit.isSuccess ? <p className="muted">Budget saved.</p> : null}
    </form>
  );
}
