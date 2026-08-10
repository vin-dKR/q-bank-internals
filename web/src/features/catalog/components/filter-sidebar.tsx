import { type JSX, useMemo } from 'react';
import type { CatalogFilterOptions } from '@ingest/contracts';
import { Button, Combobox } from '../../../shared/ui/index.js';
import type { CatalogFilterState } from '../types.js';

type Option = { value: string; label: string };

/**
 * One taxonomy filter: the shared {@link Combobox} with a pinned "Any …" row that clears the field.
 * `value` is the empty string when nothing is picked; the control shows the "any" label then.
 */
function FilterField({
  label,
  anyLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  anyLabel: string;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  // Fall back to the raw value (not "any") so an active filter whose value dropped out of the
  // re-narrowed option set stays visible instead of silently filtering behind an "All …" label.
  const current = value ? (options.find((o) => o.value === value)?.label ?? value) : anyLabel;
  const labels = useMemo(() => {
    const base = [anyLabel, ...options.map((o) => o.label)];
    if (value && !base.includes(current)) base.push(current);
    return base;
  }, [anyLabel, options, value, current]);

  const handle = (picked: string): void => {
    if (picked === anyLabel) {
      onChange('');
      return;
    }
    // Known label → its value; the injected raw value maps to itself (keeps the active filter).
    onChange(options.find((o) => o.label === picked)?.value ?? picked);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <Combobox value={current} onChange={handle} options={labels} allowCustom={false} placeholder={anyLabel} />
    </div>
  );
}

/** Map a list of raw string values to `{ value, label }` options (value === label for taxonomy). */
function toOptions(values: readonly string[]): Option[] {
  return values.map((value) => ({ value, label: value }));
}

const FLAGGED_OPTIONS: readonly Option[] = [
  { value: 'true', label: 'Flagged' },
  { value: 'false', label: 'Not flagged' },
];

/**
 * The left-rail filter panel for the Questions browse. Six dropdowns (Exam · Subject · Chapter ·
 * Section · Question type · Flagged) plus Clear. Selecting a value applies immediately — there is no
 * separate "Apply" step — and the option sets cascade: they arrive already narrowed by the current
 * exam/subject/chapter/type. `disabled` greys the controls while the first option set loads.
 */
export function FilterSidebar({
  filters,
  options,
  disabled,
  onChange,
  onClear,
}: {
  filters: CatalogFilterState;
  options: CatalogFilterOptions;
  disabled: boolean;
  onChange: (patch: Partial<CatalogFilterState>) => void;
  onClear: () => void;
}): JSX.Element {
  const hasAny =
    filters.exam !== '' ||
    filters.subject !== '' ||
    filters.chapter !== '' ||
    filters.section !== '' ||
    filters.questionType !== '' ||
    filters.flagged !== '' ||
    filters.q !== '';

  return (
    <div className="flex flex-col gap-4" aria-busy={disabled}>
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Filter questions</h2>
        <Button variant="ghost" size="xs" onClick={onClear} disabled={!hasAny}>
          Clear
        </Button>
      </div>

      <FilterField
        label="Exam"
        anyLabel="All exams"
        options={toOptions(options.exams)}
        value={filters.exam}
        onChange={(exam) => { onChange({ exam }); }}
      />
      <FilterField
        label="Subject"
        anyLabel="All subjects"
        options={toOptions(options.subjects)}
        value={filters.subject}
        onChange={(subject) => { onChange({ subject }); }}
      />
      <FilterField
        label="Chapter"
        anyLabel="All chapters"
        options={toOptions(options.chapters)}
        value={filters.chapter}
        onChange={(chapter) => { onChange({ chapter }); }}
      />
      <FilterField
        label="Section"
        anyLabel="All sections"
        options={toOptions(options.sections)}
        value={filters.section}
        onChange={(section) => { onChange({ section }); }}
      />
      <FilterField
        label="Question type"
        anyLabel="All types"
        options={toOptions(options.questionTypes)}
        value={filters.questionType}
        onChange={(questionType) => { onChange({ questionType }); }}
      />
      <FilterField
        label="Flagged status"
        anyLabel="Any status"
        options={FLAGGED_OPTIONS}
        value={filters.flagged}
        onChange={(flagged) => { onChange({ flagged: flagged as CatalogFilterState['flagged'] }); }}
      />
    </div>
  );
}
