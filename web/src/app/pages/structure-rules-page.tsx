import type { JSX } from 'react';
import { StructureRulesSettings } from '../../features/structure-rules/index.js';
import { PageHeader } from '../../shared/ui/index.js';

export function StructureRulesPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Structure example rules"
        subtitle="Set each module, textbook or PYQ exam's heading hierarchy, printed examples and expected output. Start with Section, Part and Topic, then add, rename or remove levels to match the source."
      />
      <StructureRulesSettings />
    </section>
  );
}
