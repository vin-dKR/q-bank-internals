import {
  ANOMALY_GROUPS,
  ANOMALY_KINDS,
  type AnomalyGroup,
  type AnomalyKind,
  type AnomalyKindCount,
  type AnomalySeverity,
  type AnomalyStatus,
} from '@ingest/contracts';
import type { BadgeTone } from '../../../shared/ui/index.js';

/** Badge colour for each severity: red breaks what a student sees, amber needs fixing, grey is cosmetic. */
export const SEVERITY_TONE: Record<AnomalySeverity, BadgeTone> = {
  high: 'danger',
  medium: 'progress',
  low: 'neutral',
};

export const STATUS_LABELS: Record<AnomalyStatus, string> = {
  open: 'Open',
  ignored: 'Ignored',
  resolved: 'Resolved',
};

/** The rule codes in a group, in catalogue order. */
export function kindsInGroup(group: AnomalyGroup): AnomalyKind[] {
  return (Object.keys(ANOMALY_KINDS) as AnomalyKind[]).filter((kind) => ANOMALY_KINDS[kind].group === group);
}

export type GroupCount = {
  group: AnomalyGroup;
  count: number;
  kinds: { kind: AnomalyKind; count: number }[];
};

/** Roll per-rule counts for one status up into per-group totals, busiest rules first within each group. */
export function countByGroup(byKind: AnomalyKindCount[], status: AnomalyStatus): GroupCount[] {
  return groupCounts(byKind.map((row) => ({ kind: row.kind, count: row[status] })));
}

/** The same rollup for counts that are already for one status — the filtered numbers the tree shows. */
export function groupCounts(counts: readonly { kind: AnomalyKind; count: number }[]): GroupCount[] {
  return ANOMALY_GROUPS.map((group) => {
    const kinds = counts
      .filter((row) => ANOMALY_KINDS[row.kind].group === group && row.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((row) => ({ kind: row.kind, count: row.count }));
    return { group, count: kinds.reduce((sum, row) => sum + row.count, 0), kinds };
  });
}

/**
 * Shorten text for a preview WITHOUT cutting a math block in half: a `\(` left without its `\)` renders as
 * raw source, which is exactly what the preview is meant to show is fixed. The cut falls back to the last
 * complete expression before the limit.
 */
export function clampLatex(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const opened = (cut.match(/\\\(/g) ?? []).length;
  const closed = (cut.match(/\\\)/g) ?? []).length;
  const safe = opened > closed ? cut.slice(0, cut.lastIndexOf('\\(')) : cut;
  return `${safe.trimEnd()}…`;
}

/** Make the control characters left by a bad escape visible, so the "before" side shows what is wrong. */
export function showControlChars(text: string): string {
  return text.replace(/\f/g, '␌').replace(/\t/g, '␉').replace(/\v/g, '␋').replace(/[\b]/g, '␈').replace(/\r/g, '␍');
}

/** Open problems split by how badly they hurt — the dashboard's severity row. */
export function severityTotals(byKind: AnomalyKindCount[]): Record<AnomalySeverity, number> {
  const totals: Record<AnomalySeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const row of byKind) totals[ANOMALY_KINDS[row.kind].severity] += row.open;
  return totals;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
