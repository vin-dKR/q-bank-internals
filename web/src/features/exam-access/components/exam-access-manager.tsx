import { type JSX, useMemo, useState } from 'react';
import { LoadingState } from '../../../shared/ui/index.js';
import { useExamOptions } from '../hooks/use-exam-access.js';
import { OrgAccessPanel } from './org-access-panel.js';
import { UserAccessPanel } from './user-access-panel.js';

type Tab = 'organizations' | 'users';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'organizations', label: 'Organizations' },
  { id: 'users', label: 'Users' },
];

/**
 * Masters → Exam access. Controls which exams each Eduents organization / user sees in the main
 * app's question bank. The catalog is LIVE — the distinct `exam_name` values tagged in the bank — so a
 * new exam is assignable the moment its first question lands. An empty selection inherits the
 * JEE/NEET/Boards default. Two scopes: coarse per-organization, and a per-user override that wins.
 */
export function ExamAccessManager(): JSX.Element {
  const [tab, setTab] = useState<Tab>('organizations');
  const exams = useExamOptions();

  const defaultLabels = useMemo(() => {
    if (!exams.data) return '';
    const byId = new Map(exams.data.options.map((option) => [option.id.toLowerCase(), option.label]));
    return exams.data.defaultExamIds
      .map((id) => byId.get(id.toLowerCase()) ?? id)
      .join(', ');
  }, [exams.data]);

  if (exams.isLoading) return <LoadingState label="Loading exam catalog…" />;
  if (exams.isError || !exams.data) {
    return (
      <p className="error">
        Couldn’t load the exam catalog{exams.error ? `: ${exams.error.message}` : ''}.
      </p>
    );
  }

  const options = exams.data.options;

  return (
    <div className="flex flex-col gap-4">
      {/* Catalog legend — what is assignable, and what "empty" falls back to. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
        <span className="text-[13px] font-semibold text-ink-2">Assignable exams</span>
        {options.length === 0 ? (
          <span className="text-sm text-ink-3">None tagged in the bank yet.</span>
        ) : (
          options.map((option) => (
            <span
              key={option.id}
              className="rounded-full border border-line-strong bg-surface px-2 py-0.5 text-xs font-medium text-ink-2"
            >
              {option.label}
            </span>
          ))
        )}
        {defaultLabels ? (
          <span className="ml-auto text-xs text-ink-3">
            Default when unset: <span className="font-medium text-ink-2">{defaultLabels}</span>
          </span>
        ) : null}
      </div>

      <div className="segmented self-start">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`segmented__item${tab === entry.id ? ' is-active' : ''}`}
            aria-pressed={tab === entry.id}
            onClick={() => { setTab(entry.id); }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'organizations' ? (
        <OrgAccessPanel options={options} defaultLabels={defaultLabels} />
      ) : (
        <UserAccessPanel options={options} defaultLabels={defaultLabels} />
      )}
    </div>
  );
}
