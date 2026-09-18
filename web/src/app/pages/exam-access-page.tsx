import type { JSX } from 'react';
import { ExamAccessManager } from '../../features/exam-access/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Masters → Exam access: which exam families each org / user sees in the main app's question bank. */
export function ExamAccessPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Exam access"
        subtitle="Which exam families each coaching / school — or an individual user — sees in the main app’s question bank. Empty inherits the default (JEE, NEET, Boards)."
      />
      <section className="card">
        <ExamAccessManager />
      </section>
    </section>
  );
}
