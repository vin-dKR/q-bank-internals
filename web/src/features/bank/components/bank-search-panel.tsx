import { type JSX, useState } from 'react';
import type { BankQuestion } from '@ingest/contracts';
import { useBankSearch } from '../hooks/use-bank.js';
import { RecropWorkspace } from './recrop-workspace.js';

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

/** Search the published bank, pick a hit, and fix its image in the re-crop workspace. */
export function BankSearchPanel(): JSX.Element {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<BankQuestion | null>(null);
  const results = useBankSearch(query);

  return (
    <>
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(null);
          setQuery(term.trim());
        }}
      >
        <label className="field">
          <span className="field__label">Search published questions</span>
          <div className="row">
            <input
              type="text"
              style={{ flex: 1 }}
              value={term}
              placeholder="Question text or file name…"
              onChange={(event) => { setTerm(event.target.value); }}
            />
            <button type="submit" className="btn btn--primary" disabled={term.trim().length === 0}>
              Search
            </button>
          </div>
        </label>

        {query.length === 0 ? null : results.isPending ? (
          <p className="muted">Searching…</p>
        ) : results.isError ? (
          <p className="error">Search failed. Is the bank database configured?</p>
        ) : results.data.length === 0 ? (
          <p className="muted">No published questions match “{query}”.</p>
        ) : (
          <div style={{ marginTop: 12 }}>
            {results.data.map((question) => (
              <div
                key={question.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{preview(question.questionText) || <span className="muted">(no text)</span>}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {[question.exam, question.subject, question.fileName].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {question.ingestRef ? (
                  <button
                    type="button"
                    className="btn btn--xs"
                    onClick={() => { setSelected(question); }}
                  >
                    {selected?.id === question.id ? 'Fixing…' : 'Fix image'}
                  </button>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>No source link</span>
                )}
              </div>
            ))}
          </div>
        )}
      </form>

      {selected?.ingestRef ? (
        <RecropWorkspace question={selected} ingestRef={selected.ingestRef} />
      ) : null}
    </>
  );
}
