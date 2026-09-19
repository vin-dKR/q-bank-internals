import { type JSX, useState } from 'react';
import { PageHeader } from '../../shared/ui/index.js';
import { cn } from '../../shared/lib/cn.js';
import {
  ModeSwitch,
  QualityDashboard,
  RunScanButton,
  useAiProposals,
  useQualitySummary,
  type QualityMode,
} from '../../features/quality/index.js';

/**
 * Data quality: tracked problems across the published question bank. The mode switch and Run scan sit in
 * the page header, so the working screen below them starts as high as the page allows.
 */
export function QualityPage(): JSX.Element {
  const [mode, setMode] = useState<QualityMode>('dashboard');
  const summary = useQualitySummary();
  // The AI tab's badge is how many proposals await a decision, so unreviewed work is visible from anywhere.
  const proposals = useAiProposals('pending');

  return (
    // The fix workspace is a fixed, viewport-tall screen (its columns scroll on their own), so the page holds
    // exactly the window height — `4rem` is the main element's padding. The other modes scroll normally.
    <section className={cn('page', mode === 'fix' && 'h-[calc(100dvh-4rem)] min-h-0')}>
      <PageHeader
        title="Data quality"
        subtitle="Problems in questions live on Eduents (the shared bank), tracked across scans."
        actions={
          <>
            {summary.data ? (
              <ModeSwitch
                mode={mode}
                onChange={setMode}
                openCount={summary.data.open}
                questionCount={summary.data.questionsWithOpen}
                pendingProposals={proposals.data?.pages[0]?.total ?? 0}
              />
            ) : null}
            <RunScanButton />
          </>
        }
      />
      <QualityDashboard mode={mode} onModeChange={setMode} />
    </section>
  );
}
