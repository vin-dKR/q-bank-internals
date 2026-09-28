import type { JSX } from 'react';
import type { PublishIssue } from '@ingest/contracts';
import { IconChevronDown, IconWarning } from '../../../shared/ui/icons.js';

type PublishIssueActionsProps = {
  issues: readonly PublishIssue[];
  onNavigateToQuestion: (questionId: string) => void;
};

/** Compact toolbar notice for server-validated issues that currently block this document's publish. */
export function PublishIssueActions({ issues, onNavigateToQuestion }: PublishIssueActionsProps): JSX.Element | null {
  if (issues.length === 0) return null;

  return (
    <details className="relative ml-auto flex-none">
      <summary
        className="btn list-none whitespace-nowrap border-warn/30 text-warn [&::-webkit-details-marker]:hidden"
        aria-label={`${String(issues.length)} publish ${issues.length === 1 ? 'issue' : 'issues'}`}
        title="View issues blocking the bank update"
      >
        <IconWarning />
        <span className="rounded-full bg-warn-soft px-1.5 text-xs">{issues.length}</span>
        <IconChevronDown />
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1.5 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-line-strong bg-surface p-2 shadow-lg">
        <p className="m-0 px-2 py-1 text-sm font-semibold text-warn">
          {issues.length} {issues.length === 1 ? 'issue is' : 'issues are'} blocking the bank update
        </p>
        <ul className="m-0 max-h-64 list-none space-y-1 overflow-y-auto p-0">
          {issues.map((issue, index) => {
            const questionId = issue.questionId;
            const label = issue.questionNumber === null
              ? questionId === null ? 'Document' : 'Question'
              : `Q${String(issue.questionNumber)}`;
            const content = (
              <>
                <span className="block text-xs font-semibold text-ink">{label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{issue.message}</span>
              </>
            );
            return (
              <li key={`${issue.questionId ?? 'document'}-${String(index)}`}>
                {questionId !== null ? (
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-2 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                    onClick={(event) => {
                      const menu = event.currentTarget.closest('details');
                      if (menu) menu.open = false;
                      onNavigateToQuestion(questionId);
                    }}
                  >
                    {content}
                    <span className="mt-1 block text-xs font-medium text-brand">Go to question →</span>
                  </button>
                ) : (
                  <div className="rounded-md px-2 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
