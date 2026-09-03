import type { JSX } from 'react';
import { PromptSettings } from '../../features/prompts/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * AI prompt settings — edit the text that drives extraction, figure detection (scan/crop), answer/
 * solution reading, and the LaTeX fixer. Edits are stored server-side and apply on the next run, so
 * operators can tune quality without a redeploy. "Reset to default" restores the built-in text.
 */
export function PromptsPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="AI prompts"
        subtitle="Tune the prompts that drive extraction, figure detection, and the LaTeX fixer. Saved edits apply on the next run; reset any one to its default."
      />
      <PromptSettings />
    </section>
  );
}
