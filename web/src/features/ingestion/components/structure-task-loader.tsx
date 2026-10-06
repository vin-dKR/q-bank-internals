import type { JSX } from 'react';
import { Spinner } from '../../../shared/ui/spinner.js';
import {
  structureTaskPercent,
  type StructureTaskProgress,
} from '../lib/structure-task-progress.js';

export function StructureTaskLoader({
  label,
  detail,
  progress,
  progressLabel = 'OCR completion',
}: {
  label: string;
  detail?: string;
  progress?: StructureTaskProgress;
  progressLabel?: string;
}): JSX.Element {
  const percent = progress ? structureTaskPercent(progress) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full max-w-xs flex-col items-center gap-2 rounded-xl border border-brand/20 bg-surface p-5 text-center shadow-lg"
    >
      <Spinner className="size-10 text-brand motion-reduce:animate-none" />
      <span className="text-sm font-semibold text-ink">{label}</span>
      {progress && percent !== null ? (
        <>
          <span className="text-2xl font-semibold tabular-nums text-brand">{percent}%</span>
          <div
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${String(progress.completed)} of ${String(progress.total)} crops processed`}
            className="h-2 w-full overflow-hidden rounded-full bg-brand/10"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] motion-reduce:transition-none"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <span className="text-xs text-ink-3">
            {progress.completed} / {progress.total} crops processed
          </span>
        </>
      ) : null}
      {detail ? <span className="text-xs text-ink-3">{detail}</span> : null}
    </div>
  );
}
