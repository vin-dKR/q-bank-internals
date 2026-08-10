import type { JSX } from 'react';
import { PdfEditorTool } from '../../features/pdf-editor/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Pdf Editor tool page: overlay text/images on a PDF and export the edited file. */
export function PdfEditorPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Pdf Editor"
        subtitle="Overlay text and images on a PDF, then export the edited document."
      />
      <PdfEditorTool />
    </section>
  );
}
