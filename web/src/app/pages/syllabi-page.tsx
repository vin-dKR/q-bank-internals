import type { JSX } from 'react';
import { SyllabusList, SyllabusUploadCard } from '../../features/syllabi/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * The exam syllabus: every exam's subjects → chapters → topics, and the upload that replaces one. This is
 * the vocabulary "Fix with AI · topic" chooses from — a question is only ever matched against its own
 * exam's syllabus, so an exam missing here has its questions reported rather than guessed at.
 */
export function SyllabiPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Exam syllabus"
        subtitle="Each exam's subjects, chapters and topics — the only topics the AI may choose from for that exam's questions. Upload JSON or CSV to add an exam or replace one."
      />
      <SyllabusUploadCard />
      <SyllabusList />
    </section>
  );
}
