import { type JSX, useState } from 'react';
import type { BankQuestion } from '@ingest/contracts';
import { Button, IconChevronRight, IconSearch, Skeleton } from '../../../shared/ui/index.js';
import { useBankSearch } from '../hooks/use-bank.js';

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

function hitMeta(question: BankQuestion): string {
  return [question.exam, question.subject, question.fileName].filter(Boolean).join(' · ') || '—';
}

/**
 * Search the published bank and pick a hit to fix. The chosen question is handed back so the Verify
 * workspace can reopen the exact document + page it was published from — the same portal the unit
 * index opens. A hit with no `ingestRef` predates provenance and can't be traced to a source, so it
 * is shown but not openable. Rendered inside the entry screen's card; hits use the shared
 * `.pick-row` language so they read as one system with the unit list beside them.
 */
export function BankQuestionSearch({
  onPick,
}: {
  onPick: (question: BankQuestion) => void;
}): JSX.Element {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const results = useBankSearch(query);

  return (
    <>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(term.trim());
        }}
      >
        <input
          type="text"
          className="min-w-0 flex-1"
          aria-label="Search published questions"
          value={term}
          placeholder="Question text or file name…"
          onChange={(event) => { setTerm(event.target.value); }}
        />
        <Button type="submit" variant="primary" className="flex-none" disabled={term.trim().length === 0}>
          <IconSearch /> Search
        </Button>
      </form>

      {query.length === 0 ? null : results.isPending ? (
        <div className="flex flex-col gap-1" aria-hidden="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : results.isError ? (
        <p className="error">Search failed. Is the bank database configured?</p>
      ) : results.data.length === 0 ? (
        <p className="muted">No published questions match “{query}”.</p>
      ) : (
        <ul className="pick-list">
          {results.data.map((question) => (
            <li key={question.id}>
              {question.ingestRef ? (
                <button
                  type="button"
                  className="pick-row"
                  onClick={() => { onPick(question); }}
                >
                  <span className="pick-row__text">
                    <span className="pick-row__name">
                      {preview(question.questionText) || '(no text)'}
                    </span>
                    <span className="pick-row__meta">{hitMeta(question)}</span>
                  </span>
                  <IconChevronRight className="pick-row__go" />
                </button>
              ) : (
                <div className="pick-row pick-row--static">
                  <span className="pick-row__text">
                    <span className="pick-row__name">
                      {preview(question.questionText) || '(no text)'}
                    </span>
                    <span className="pick-row__meta">{hitMeta(question)}</span>
                  </span>
                  <span className="pick-row__meta flex-none">No source link</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
