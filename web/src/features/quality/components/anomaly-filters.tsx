import { type JSX, type ReactNode, useEffect, useId, useState } from 'react';
import {
  ANOMALY_GROUP_LABELS,
  ANOMALY_GROUPS,
  ANOMALY_KINDS,
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  AnomalyGroupSchema,
  AnomalyKindSchema,
  AnomalySeveritySchema,
  type QualityFilterOptions,
  type QualitySummary,
} from '@ingest/contracts';
import { Button } from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { useQualityFilterOptions } from '../hooks/use-quality.js';
import { STATUS_LABELS, kindsInGroup } from '../lib/anomaly-display.js';
import type { QualityFilterState } from '../types.js';

const SEARCH_DEBOUNCE_MS = 300;
const SELECT_CLASS = 'min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-60';
const EMPTY_OPTIONS: QualityFilterOptions = { exams: [], subjects: [], chapters: [], byKind: [] };

/** Keyword box that pushes its text up once typing pauses, and follows outside resets. */
function SearchInput({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }): JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value, disabled]);
  useEffect(() => {
    if (disabled || text === value) return;
    const id = setTimeout(() => { onChange(text); }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(id); };
  }, [text, value, disabled, onChange]);
  return (
    <input
      type="search"
      value={text}
      disabled={disabled}
      onChange={(event) => { setText(event.target.value); }}
      placeholder="Search questions, files, or IDs"
      aria-label="Search questions, source files, or question IDs"
      className={cn(SELECT_CLASS, 'min-w-[220px] flex-1 placeholder:text-ink-3')}
    />
  );
}

/** Keep a selected taxonomy value visible after fixing the last issue that offered it. */
function withCurrent(values: readonly string[], current: string): string[] {
  return current === '' || values.includes(current) ? [...values] : [...values, current];
}

/** The everyday controls stay in one row; less common taxonomy filters open on demand. */
export function AnomalyFilters({
  filters,
  summary,
  showRulePicker = true,
  showStatusTabs = true,
  disabled = false,
  disabledMessage = 'Save or discard your edits to change filters.',
  actions,
  onChange,
  onClear,
}: {
  filters: QualityFilterState;
  summary: QualitySummary;
  showRulePicker?: boolean;
  /** Historical statuses belong in the issue browser, not in a queue of work to fix. */
  showStatusTabs?: boolean;
  /** Keep an unsaved question draft in view until the operator saves or discards it. */
  disabled?: boolean;
  disabledMessage?: string;
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
  const options = optionsQuery.data ?? EMPTY_OPTIONS;
  const advancedId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedCount = [filters.severity, filters.exam, filters.subject, filters.chapter].filter(Boolean).length;
  const hasNarrowing = [filters.group, filters.kind, filters.severity, filters.exam, filters.subject, filters.chapter, filters.q].some(Boolean);
  const groups = filters.group ? [filters.group] : ANOMALY_GROUPS;

  return (
    <div className="flex flex-col gap-3">
      {showStatusTabs ? (
        <div role="group" aria-label="Issue status" className="flex flex-wrap gap-1 border-b border-line">
          {ANOMALY_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={filters.status === status}
              disabled={disabled}
              title={`${summary[status].toLocaleString()} total across the bank`}
              onClick={() => { onChange({ status }); }}
              className={cn(
                '-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                filters.status === status ? 'border-brand text-ink' : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {STATUS_LABELS[status]}
              <span className="ml-1.5 text-xs tabular-nums text-ink-3">{summary[status].toLocaleString()}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={filters.q} disabled={disabled} onChange={(q) => { onChange({ q }); }} />
        {showRulePicker ? (
          <>
            <select
              aria-label="Issue category"
              disabled={disabled}
              className={cn(SELECT_CLASS, 'max-w-[200px] flex-1')}
              value={filters.group}
              onChange={(event) => {
                const group = AnomalyGroupSchema.safeParse(event.target.value);
                onChange({ group: group.success ? group.data : '' });
              }}
            >
              <option value="">All categories</option>
              {ANOMALY_GROUPS.map((group) => <option key={group} value={group}>{ANOMALY_GROUP_LABELS[group]}</option>)}
            </select>
            <select
              aria-label="Issue type"
              disabled={disabled}
              className={cn(SELECT_CLASS, 'max-w-[260px] flex-1')}
              value={filters.kind}
              onChange={(event) => {
                const kind = AnomalyKindSchema.safeParse(event.target.value);
                onChange({ kind: kind.success ? kind.data : '' });
              }}
            >
              <option value="">All issue types</option>
              {groups.map((group) => (
                <optgroup key={group} label={ANOMALY_GROUP_LABELS[group]}>
                  {kindsInGroup(group).map((kind) => <option key={kind} value={kind}>{ANOMALY_KINDS[kind].label}</option>)}
                </optgroup>
              ))}
            </select>
          </>
        ) : null}
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          disabled={disabled}
          onClick={() => { setAdvancedOpen((open) => !open); }}
          className={cn(
            'cursor-pointer rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60',
            advancedOpen && 'bg-surface-2 text-ink',
          )}
        >
          More filters{advancedCount > 0 ? ` (${String(advancedCount)})` : ''}
        </button>
        {hasNarrowing ? <Button variant="ghost" size="xs" disabled={disabled} onClick={onClear}>Clear</Button> : null}
        {actions ? <span className="ml-auto flex items-center gap-2">{actions}</span> : null}
      </div>
      {disabled ? <p className="m-0 text-xs text-ink-3">{disabledMessage}</p> : null}

      <div id={advancedId} className={advancedOpen ? 'flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3' : 'hidden'}>
        {filters.kind === '' ? (
          <select
            aria-label="Severity"
            disabled={disabled}
            className={SELECT_CLASS}
            value={filters.severity}
            onChange={(event) => {
              const severity = AnomalySeveritySchema.safeParse(event.target.value);
              onChange({ severity: severity.success ? severity.data : '' });
            }}
          >
            <option value="">Any severity</option>
            {ANOMALY_SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
          </select>
        ) : null}
        <select aria-label="Exam" disabled={disabled} className={SELECT_CLASS} value={filters.exam} onChange={(event) => { onChange({ exam: event.target.value }); }}>
          <option value="">Any exam</option>
          {withCurrent(options.exams, filters.exam).map((exam) => <option key={exam} value={exam}>{exam}</option>)}
        </select>
        <select aria-label="Subject" disabled={disabled} className={SELECT_CLASS} value={filters.subject} onChange={(event) => { onChange({ subject: event.target.value }); }}>
          <option value="">Any subject</option>
          {withCurrent(options.subjects, filters.subject).map((subject) => <option key={subject} value={subject}>{subject}</option>)}
        </select>
        <select aria-label="Chapter" disabled={disabled} className={cn(SELECT_CLASS, 'max-w-[260px]')} value={filters.chapter} onChange={(event) => { onChange({ chapter: event.target.value }); }}>
          <option value="">Any chapter</option>
          {withCurrent(options.chapters, filters.chapter).map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
        </select>
      </div>
    </div>
  );
}
