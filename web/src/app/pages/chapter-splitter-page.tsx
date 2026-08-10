import type { JSX } from 'react';
import { ChapterSplitterTool } from '../../features/chapter-splitter/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Chapter Splitter tool page: split one PDF into named page-range chapters. */
export function ChapterSplitterPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Chapter Splitter"
        subtitle="Split a PDF into named page-range chapters — download each, or all as a zip."
      />
      <ChapterSplitterTool />
    </section>
  );
}
