import { type JSX, useState } from 'react';
import type { BankQuestion } from '@ingest/contracts';
import { Button, LoadingState } from '../../../shared/ui/index.js';
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
              className="min-w-0 flex-1"
              value={term}
              placeholder="Question text or file name…"
              onChange={(event) => { setTerm(event.target.value); }}
            />
            <Button type="submit" variant={selected ? 'default' : 'primary'} disabled={term.trim().length === 0}>
              Search
            </Button>
          </div>
        </label>

        {query.length === 0 ? null : results.isPending ? (
          <LoadingState label="Searching…" />
        ) : results.isError ? (
          <p className="error">Search failed. Is the bank database configured?</p>
        ) : results.data.length === 0 ? (
          <p className="muted">No published questions match “{query}”.</p>
        ) : (
          <ul className="bank-hit-list">
            {results.data.map((question) => (
              <li key={question.id} className="bank-hit">
                <div className="bank-hit__body">
                  <div>{preview(question.questionText) || <span className="muted">(no text)</span>}</div>
                  <div className="bank-hit__meta">
                    {[question.exam, question.subject, question.fileName].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {question.ingestRef ? (
                  <Button size="xs" onClick={() => { setSelected(question); }}>
                    {selected?.id === question.id ? 'Fixing…' : 'Fix image'}
                  </Button>
                ) : (
                  <span className="bank-hit__meta">No source link</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </form>

      {selected?.ingestRef ? (
        <RecropWorkspace question={selected} ingestRef={selected.ingestRef} />
      ) : null}
    </>
  );
}
