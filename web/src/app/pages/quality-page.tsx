import { type JSX, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { PageHeader, useConfirm, useToast } from '../../shared/ui/index.js';
import {
  ModeSwitch,
  QualityDashboard,
  RunScanButton,
  useAiProposals,
  useQualitySummary,
  type QualityMode,
} from '../../features/quality/index.js';

/** The page keeps navigation in one place so an unfinished question cannot be left by accident. */
export function QualityPage(): JSX.Element {
  const [mode, setMode] = useState<QualityMode>('overview');
  const [fixDirty, setFixDirty] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const { toast } = useToast();
  const blocker = useBlocker(fixDirty || aiRunning);
  const handlingBlock = useRef(false);
  const summary = useQualitySummary();
  const proposals = useAiProposals('pending');

  useEffect(() => {
    if (blocker.state !== 'blocked' || handlingBlock.current) return;
    if (!aiRunning && !fixDirty) {
      blocker.proceed();
      return;
    }
    if (aiRunning) {
      blocker.reset();
      toast({ title: 'AI run in progress', description: 'Stop the run and wait for its current batch to finish before leaving Data quality.' });
      return;
    }
    handlingBlock.current = true;
    void confirm({
      title: 'Discard unsaved changes?',
      body: 'The edits to this question have not been saved to the bank.',
      confirmLabel: 'Discard changes',
      tone: 'danger',
    }).then((leave) => {
      if (leave) blocker.proceed();
      else blocker.reset();
    }).finally(() => { handlingBlock.current = false; });
  }, [blocker, confirm, aiRunning, fixDirty, toast]);

  useEffect(() => {
    if (!fixDirty && !aiRunning) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); };
  }, [fixDirty, aiRunning]);

  const confirmLeaveFix = async (): Promise<boolean> => {
    if (!fixDirty) return true;
    const leave = await confirm({
      title: 'Discard unsaved changes?',
      body: 'The edits to this question have not been saved to the bank.',
      confirmLabel: 'Discard changes',
      tone: 'danger',
    });
    if (leave) setFixDirty(false);
    return leave;
  };

  const changeMode = async (next: QualityMode): Promise<void> => {
    if (next === mode || aiRunning || !(await confirmLeaveFix())) return;
    setMode(next);
  };

  return (
    <section className="page">
      <PageHeader
        title="Data quality"
        subtitle="Find and fix problems in published questions. Scans check the shared bank, not unpublished ingest work."
        actions={<RunScanButton variant="default" disabled={aiRunning} />}
      />
      <ModeSwitch
        mode={mode}
        onChange={(next) => { void changeMode(next); }}
        questionCount={summary.data?.questionsWithOpen ?? 0}
        pendingProposals={proposals.data?.pages[0]?.total ?? 0}
        aiRunning={aiRunning}
      />
      <QualityDashboard
        mode={mode}
        onModeChange={(next) => { void changeMode(next); }}
        fixDirty={fixDirty}
        onFixDirtyChange={setFixDirty}
        aiRunning={aiRunning}
        onAiRunningChange={setAiRunning}
      />
      {confirmDialog}
    </section>
  );
}
