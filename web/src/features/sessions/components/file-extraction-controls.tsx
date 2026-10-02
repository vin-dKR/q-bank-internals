import { type JSX } from 'react';
import type { Document } from '@ingest/contracts';
import { Spinner } from '../../../shared/ui/index.js';
import {
  useDocumentExtractionJob,
  usePauseDocumentExtraction,
  useResumeDocumentExtraction,
} from '../hooks/use-sessions.js';

/**
 * File-row controls for the durable extraction job that belongs to one question PDF. A paused or
 * failed job remains attached to this document, so Resume preserves its saved page drafts rather
 * than creating a replacement job that would spend tokens on finished pages again.
 */
export function FileExtractionControls({
  document,
  onRun,
  onStop,
  runPending,
  stopPending,
}: {
  document: Document;
  onRun: (document: Document) => void;
  onStop: (document: Document) => void;
  runPending: boolean;
  stopPending: boolean;
}): JSX.Element | null {
  const job = useDocumentExtractionJob(document.id);
  const pause = usePauseDocumentExtraction();
  const resume = useResumeDocumentExtraction();
  const data = job.data;
  const inFlight = document.status === 'queued' || document.status === 'extracting';
  const pausableJob = data?.status === 'queued' || data?.status === 'running' ? data : null;
  const resumable = data?.status === 'paused' || data?.status === 'failed';

  if (inFlight) {
    return (
      <>
        <button
          type="button"
          className="btn btn--xs"
          disabled={!pausableJob || pause.isPending}
          onClick={() => { if (pausableJob) pause.mutate(pausableJob.id); }}
        >
          Pause
        </button>
        <button
          type="button"
          className="btn btn--xs btn--danger"
          disabled={stopPending}
          onClick={() => { onStop(document); }}
        >
          Stop
        </button>
      </>
    );
  }

  if (document.status === 'paused') {
    if (!data) return <Spinner />;
    return (
      <button
        type="button"
        className="btn btn--xs"
        disabled={!resumable || resume.isPending}
        onClick={() => { if (resumable) resume.mutate(document.id); }}
      >
        Resume
      </button>
    );
  }

  if (resumable) {
    return (
      <button
        type="button"
        className="btn btn--xs"
        disabled={resume.isPending}
        onClick={() => { resume.mutate(document.id); }}
      >
        Resume
      </button>
    );
  }

  if (document.status === 'uploaded' || document.status === 'failed') {
    return (
      <button
        type="button"
        className="btn btn--xs"
        disabled={runPending}
        onClick={() => { onRun(document); }}
      >
        Run
      </button>
    );
  }

  return null;
}
