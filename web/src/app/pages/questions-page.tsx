import type { JSX } from 'react';
import { QuestionsBrowse } from '../../features/catalog/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * "Questions" — browse the published question bank read-only: filter by exam/subject/chapter/section/
 * type/flag, search by keyword, and read each question rendered (KaTeX + images). No folders, no
 * paper generation — just find questions.
 */
export function QuestionsPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Questions"
        subtitle="Browse the published question bank — filter, search, and read questions."
      />
      <QuestionsBrowse />
    </section>
  );
}
