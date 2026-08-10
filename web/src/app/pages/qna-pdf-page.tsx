import type { JSX } from 'react';
import { QnaPdfTool } from '../../features/qna-pdf/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** QnA PDF Generator tool page: split selected (answer) pages from the rest (question) pages. */
export function QnaPdfPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="QnA PDF Generator"
        subtitle="Mark the answer pages, then export a zip of answer + question PDFs."
      />
      <QnaPdfTool />
    </section>
  );
}
