import type { JSX } from 'react';
import { BankSearchPanel } from '../../features/bank/index.js';
import { PageHeader } from '../../shared/ui/index.js';

/**
 * Find & fix published questions: search the main bank, then re-crop a question or option image from
 * the exact source page it was published from (via the `ingest_ref` stamped at publish time).
 */
export function BankPage(): JSX.Element {
  return (
    <section className="page">
      <PageHeader
        title="Fix published questions"
        subtitle="Search the main bank, then re-crop a wrong question or option image from its source page."
      />
      <BankSearchPanel />
    </section>
  );
}
