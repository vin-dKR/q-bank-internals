import type { JSX } from 'react';
import { TaxonomyManager } from '../../features/taxonomy/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/** Masters → Question taxonomy: CRUD over the normalized dictionaries the extractor + publisher resolve against. */
export function TaxonomyPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Question taxonomy"
        subtitle="The normalized dictionaries every bank question files against — modules, exams, subjects, chapters, sections, question types, difficulty, and topics. Modules are independent content providers such as Allen or PW. The extractor picks IDs from these and the publisher stamps them onto each question."
      />
      <section className="card">
        <TaxonomyManager />
      </section>
    </section>
  );
}
