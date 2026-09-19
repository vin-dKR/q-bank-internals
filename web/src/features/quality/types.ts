import type { AnomalyGroup, AnomalyKind, AnomalySeverity, AnomalyStatus } from '@ingest/contracts';

/** The active anomaly-list selection held by the dashboard. '' means "any" for every optional filter. */
export type QualityFilterState = {
  status: AnomalyStatus;
  group: AnomalyGroup | '';
  kind: AnomalyKind | '';
  severity: AnomalySeverity | '';
  exam: string;
  subject: string;
  chapter: string;
  q: string;
};

/** The starting selection: every open anomaly, unfiltered. */
export const EMPTY_QUALITY_FILTERS: QualityFilterState = {
  status: 'open',
  group: '',
  kind: '',
  severity: '',
  exam: '',
  subject: '',
  chapter: '',
  q: '',
};

/** The taxonomy part of the selection — what the cascading dropdown values are narrowed against. */
export type QualitySelection = Pick<QualityFilterState, 'status' | 'group' | 'kind' | 'severity' | 'exam' | 'subject' | 'chapter'>;
