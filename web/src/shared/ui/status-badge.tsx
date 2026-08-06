import type { JSX } from 'react';
import type { DocumentStatus, SessionStatus } from '@ingest/contracts';
import { Badge, type BadgeTone } from './badge.js';

type Tone = BadgeTone;

/** One place mapping every pipeline status to its colour tone — keeps the badge language consistent. */
const TONE: Record<DocumentStatus | SessionStatus, Tone> = {
  // document statuses
  uploaded: 'neutral',
  queued: 'info',
  extracting: 'progress',
  extracted: 'success',
  needs_review: 'review',
  approved: 'success',
  published: 'success',
  completed: 'success',
  failed: 'danger',
  // session statuses
  open: 'neutral',
  partially_extracted: 'progress',
};

/** A coloured status pill used for documents and sessions alike. */
export function StatusBadge({ status }: { status: DocumentStatus | SessionStatus }): JSX.Element {
  return <Badge tone={TONE[status]}>{status.replace(/_/g, ' ')}</Badge>;
}
