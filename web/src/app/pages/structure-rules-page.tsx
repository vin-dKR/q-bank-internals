import type { JSX } from 'react';
import { StructureRulesSettings } from '../../features/structure-rules/index.js';
import { PageHeader } from '../../shared/ui/index.js';

export function StructureRulesPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Structure example rules"
        subtitle="Save the printed Section, Part and Topic heading formats for each module, textbook or PYQ exam. AI loads the matching examples when you detect a PDF's structure."
      />
      <StructureRulesSettings />
    </section>
  );
}
