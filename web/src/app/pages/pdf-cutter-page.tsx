import type { JSX } from 'react';
import { PdfCutterTool } from '../../features/pdf-cutter/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** PDF Page Cutter tool page: cut pages at horizontal lines and reflow the slices onto A4. */
export function PdfCutterPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="PDF Page Cutter"
        subtitle="Draw cut lines on each page and export a reflowed PDF with one slice per A4 page."
      />
      <PdfCutterTool />
    </section>
  );
}
