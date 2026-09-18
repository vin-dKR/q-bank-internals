import { type JSX, type ReactNode, useEffect, useState } from 'react';
import {
  ANOMALY_GROUP_LABELS,
  ANOMALY_GROUPS,
  ANOMALY_KINDS,
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  AnomalyKindSchema,
  AnomalySeveritySchema,
  type AnomalyKind,
  type QualityFilterOptions,
  type QualitySummary,
} from '@ingest/contracts';
import { Button } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { useQualityFilterOptions } from '../hooks/use-quality.js';
import { STATUS_LABELS, kindsInGroup } from '../lib/anomaly-display.js';
import type { QualityFilterState } from '../types.js';

const SEARCH_DEBOUNCE_MS = 300;

const SELECT_CLASS = 'w-auto min-w-0 max-w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm';

/** Keyword box that pushes its text up once typing pauses, and follows outside resets. */
function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => { onChange(text); }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(id); };
  }, [text, value, onChange]);
  return (
    <input
      type="search"
      value={text}
      onChange={(event) => { setText(event.target.value); }}
      placeholder="Search question text, file name, or question id…"
      aria-label="Search anomalies"
      className="min-w-[240px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
    />
  );
}

/**
 * The anomaly-list controls: status tabs with their totals, then rule / severity / subject / chapter
 * narrowing and a keyword search. The rule dropdown only offers rules in the selected group.
 */
const EMPTY_OPTIONS: QualityFilterOptions = { exams: [], subjects: [], chapters: [], byKind: [] };

/**
 * The offered values plus the current one. A chosen value can drop out of its own narrowed set (it is the
 * only anomaly of that chapter and you just fixed it); keeping it listed stops the dropdown from silently
 * showing "Any chapter" while the filter is still applied.
 */
function withCurrent(values: readonly string[], current: string): string[] {
  return current === '' || values.includes(current) ? [...values] : [...values, current];
}

export function AnomalyFilters({
  filters,
  summary,
  showRulePicker = true,
  actions,
  onChange,
  onClear,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
  /** False where the rules are chosen by the workspace's own tiles and list, so the dropdown would be a second way to do one thing. */
  showRulePicker?: boolean;
  /** Rendered at the end of the controls row — the workspace puts its "Fix all" button here. */
  actions?: ReactNode;
  onChange: (patch: Partial<QualityFilterState>) => void;
  onClear: () => void;
}): JSX.Element {
  const optionsQuery = useQualityFilterOptions({
    status: filters.status,
    group: filters.group,
    kind: filters.kind,
    severity: filters.severity,
    exam: filters.exam,
    subject: filters.subject,
    chapter: filters.chapter,
  });
  // The count beside each rule follows the other filters (exam, subject, chapter, severity, search), so the
  // dropdown never promises 1,045 when the current selection holds none. Until they load, the unfiltered
  // summary stands in.
  const countFor = (kind: AnomalyKind): number =>
    optionsQuery.data
      ? (optionsQuery.data.byKind.find((row) => row.kind === kind)?.count ?? 0)
      : (summary.byKind.find((row) => row.kind === kind)?.[filters.status] ?? 0);
  const ruleSeverity = filters.kind === '' ? null : ANOMALY_KINDS[filters.kind].severity;
  const groups = filters.group ? [filters.group] : ANOMALY_GROUPS;
  const hasNarrowing =
    filters.group !== '' ||
    filters.kind !== '' ||
    filters.severity !== '' ||
    filters.exam !== '' ||
    filters.subject !== '' ||
    filters.chapter !== '' ||
    filters.q !== '';
  const options = optionsQuery.data ?? EMPTY_OPTIONS;

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
        {ANOMALY_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={filters.status === status}
            onClick={() => { onChange({ status }); }}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              filters.status === status ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            {STATUS_LABELS[status]} <span className="tabular-nums text-ink-3">{summary[status].toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={filters.q} onChange={(q) => { onChange({ q }); }} />
        {showRulePicker ? (
          <select
            aria-label="Rule"
            className={SELECT_CLASS}
            value={filters.kind}
            onChange={(event) => {
              const kind = AnomalyKindSchema.safeParse(event.target.value);
              onChange({ kind: kind.success ? kind.data : '' });
            }}
          >
            <option value="">All rules</option>
            {groups.map((group) => (
              <optgroup key={group} label={ANOMALY_GROUP_LABELS[group]}>
                {kindsInGroup(group).map((kind) => (
                  <option key={kind} value={kind}>
                    {ANOMALY_KINDS[kind].label} ({countFor(kind).toLocaleString()})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : null}
        {ruleSeverity !== null ? (
          // A rule has exactly one severity, so a separate severity choice could only ever contradict it
          // (High "Answer missing" filtered to low leaves nothing). Shown, not chosen, while a rule is picked.
          <select aria-label="Severity" className={SELECT_CLASS} value={ruleSeverity} disabled title="Set by the selected rule">
            <option value={ruleSeverity}>{ruleSeverity} (set by rule)</option>
          </select>
        ) : (
          <select
            aria-label="Severity"
            className={SELECT_CLASS}
            value={filters.severity}
            onChange={(event) => {
              const severity = AnomalySeveritySchema.safeParse(event.target.value);
              onChange({ severity: severity.success ? severity.data : '' });
            }}
          >
            <option value="">Any severity</option>
            {ANOMALY_SEVERITIES.map((severity) => (
              <option key={severity} value={severity} className="capitalize">{severity}</option>
            ))}
          </select>
        )}
        <select
          aria-label="Exam"
          className={SELECT_CLASS}
          value={filters.exam}
          onChange={(event) => { onChange({ exam: event.target.value }); }}
        >
          <option value="">Any exam</option>
          {withCurrent(options.exams, filters.exam).map((exam) => <option key={exam} value={exam}>{exam}</option>)}
        </select>
        <select
          aria-label="Subject"
          className={SELECT_CLASS}
          value={filters.subject}
          onChange={(event) => { onChange({ subject: event.target.value }); }}
        >
          <option value="">Any subject</option>
          {withCurrent(options.subjects, filters.subject).map((subject) => <option key={subject} value={subject}>{subject}</option>)}
        </select>
        <select
          aria-label="Chapter"
          className={cn(SELECT_CLASS, 'max-w-[260px]')}
          value={filters.chapter}
          onChange={(event) => { onChange({ chapter: event.target.value }); }}
        >
          <option value="">Any chapter</option>
          {withCurrent(options.chapters, filters.chapter).map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
        </select>
        {hasNarrowing ? (
          <Button variant="ghost" size="xs" onClick={onClear}>Clear filters</Button>
        ) : null}
        {actions ? <span className="ml-auto flex items-center gap-2">{actions}</span> : null}
      </div>
    </div>
  );
}
