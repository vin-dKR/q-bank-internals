import { type JSX, useEffect, useRef } from 'react';
import { useToast } from '../../../shared/ui/index.js';
import { useDocumentExtractionJob, useResetDocumentExtraction } from '../hooks/use-sessions.js';

/** Terminal states, after which the run no longer moves and the bar can be dismissed. */
const DONE = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Live status bar for one document's extraction: a determinate pages bar (count + %), the running
 * question tally, a Stop action while it runs, and a one-shot completion toast. Driven by the document
 * id — it polls the shared job row — so every operator viewing the file sees the same progress, and it
 * surfaces on serverless too (where the tab that started the run can't learn the job id in time to poll
 * it). Self-pruning: it calls `onDismiss` a moment after the run reaches a terminal state so the operator
 * sees the final frame.
 */
export function ExtractionProgress({
  documentId,
  fileName,
  onDismiss,
}: {
  documentId: string;
  fileName?: string | undefined;
  onDismiss: () => void;
}): JSX.Element | null {
  const job = useDocumentExtractionJob(documentId);
  const reset = useResetDocumentExtraction();
  const { toast } = useToast();
  const notified = useRef(false);

  const data = job.data;
  const status = data?.status;

  useEffect(() => {
    if (!data || notified.current || !DONE.has(data.status)) return;
    notified.current = true;
    if (data.status === 'succeeded') {
      toast({
        title: 'Extraction complete',
        description: `${String(data.questionsFound)} question${data.questionsFound === 1 ? '' : 's'} extracted.`,
        tone: 'success',
      });
    } else if (data.status === 'failed') {
      toast({ title: 'Extraction failed', description: data.error ?? undefined, tone: 'error' });
    } else {
      toast({ title: 'Extraction cancelled', tone: 'info' });
    }
    const timer = window.setTimeout(onDismiss, 2500);
    return () => { window.clearTimeout(timer); };
  }, [data, toast, onDismiss]);

  if (!data) return null;

  const running = status === 'queued' || status === 'running';
  const pct = data.pagesTotal > 0 ? Math.round((data.pagesDone / data.pagesTotal) * 100) : 0;
  const fillTone =
    status === 'failed' ? 'bg-bad' : status === 'cancelled' ? 'bg-ink-3' : 'bg-brand';
  const prefix = fileName ? `${fileName} — ` : '';

  const headline =
    status === 'succeeded'
      ? `${prefix}Extracted ${String(data.questionsFound)} question${data.questionsFound === 1 ? '' : 's'}`
      : status === 'failed'
        ? `${prefix}Extraction failed`
        : status === 'cancelled'
          ? `${prefix}Extraction cancelled`
          : status === 'queued'
            ? `${prefix}Queued…`
            : `${prefix}Extracting — ${String(data.questionsFound)} question${data.questionsFound === 1 ? '' : 's'} so far`;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-3 text-[13px] font-medium">
        <span className="min-w-0 truncate text-ink">{headline}</span>
        <div className="flex flex-none items-center gap-2">
          <span className="text-ink-3">
            {data.pagesTotal > 0 ? `${String(data.pagesDone)}/${String(data.pagesTotal)} pages · ${String(pct)}%` : null}
          </span>
          {running ? (
            <button
              type="button"
              className="btn btn--ghost btn--xs btn--danger"
              disabled={reset.isPending}
              onClick={() => { reset.mutate(documentId); }}
            >
              Stop
            </button>
          ) : null}
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-all ${fillTone}`} style={{ width: `${String(running && data.pagesTotal === 0 ? 6 : pct)}%` }} />
      </div>
    </div>
  );
}
