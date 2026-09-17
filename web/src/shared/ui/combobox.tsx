import { type JSX, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconPlus } from './icons.js';

/** An option whose stored value differs from its shown label (e.g. a master id/slug + display name). */
export type ComboboxOption = { value: string; label: string };

type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  /**
   * The choices. A plain `string` is both value and label; a `{ value, label }` stores `value` while
   * showing `label` — so a field can display a master's name yet persist its id / behavior slug.
   */
  options: readonly (string | ComboboxOption)[];
  /** Allow committing free text that isn't an existing option (creatable). Default true. */
  allowCustom?: boolean;
  placeholder?: string;
  id?: string;
};

/**
 * A searchable, optionally creatable select: type to filter existing values, pick one with the
 * mouse or keyboard, or (when `allowCustom`) commit the typed text as a new value. The one control
 * for every "choose from known values, maybe add a new one" field — replaces native `<select>` plus
 * the parallel "Custom…" text input. Options may carry a separate value/label so the stored value
 * (a master id or behavior slug) can differ from the displayed name.
 */
export function Combobox({
  value,
  onChange,
  options,
  allowCustom = true,
  placeholder,
  id,
}: ComboboxProps): JSX.Element {
  const generatedId = useId();
  const listId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const opts = useMemo<ComboboxOption[]>(
    () => options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option)),
    [options],
  );

  /** The label shown for the current value (its option's label, or the raw value for free text). */
  const displayLabel = useMemo(
    () => opts.find((option) => option.value === value)?.label ?? value,
    [opts, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((option) => option.label.toLowerCase().includes(q));
  }, [opts, query]);

  const trimmed = query.trim();
  const exactMatch = opts.some((option) => option.label.toLowerCase() === trimmed.toLowerCase());
  const showCreate = allowCustom && trimmed.length > 0 && !exactMatch;
  const rowCount = filtered.length + (showCreate ? 1 : 0);

  const openList = (): void => { setQuery(''); setActive(0); setOpen(true); };

  const commit = (next: string): void => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };

  const commitActive = (): void => {
    if (showCreate && active === filtered.length) {
      commit(trimmed);
      return;
    }
    const picked = filtered[active];
    if (picked !== undefined) commit(picked.value);
    else if (allowCustom && trimmed) commit(trimmed);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { openList(); return; }
      setActive((index) => (rowCount === 0 ? 0 : (index + 1) % rowCount));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (rowCount === 0 ? 0 : (index - 1 + rowCount) % rowCount));
    } else if (event.key === 'Enter') {
      if (open) { event.preventDefault(); commitActive(); }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="combobox" ref={rootRef}>
      <div className="combobox__field">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={open ? query : displayLabel}
          onFocus={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            if (allowCustom) onChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <IconChevronDown className="combobox__caret" aria-hidden />
      </div>

      {open ? (
        <ul className="combobox__pop" id={listId} role="listbox">
          {filtered.length === 0 && !showCreate ? (
            <li className="combobox__empty">No matches</li>
          ) : null}
          {filtered.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`combobox__option ${index === active ? 'is-active' : ''}`}
              onMouseEnter={() => { setActive(index); }}
              onMouseDown={(event) => { event.preventDefault(); commit(option.value); }}
            >
              {option.label}
            </li>
          ))}
          {showCreate ? (
            <li
              role="option"
              aria-selected={false}
              className={`combobox__option combobox__create ${active === filtered.length ? 'is-active' : ''}`}
              onMouseEnter={() => { setActive(filtered.length); }}
              onMouseDown={(event) => { event.preventDefault(); commit(trimmed); }}
            >
              <IconPlus /> Create “{trimmed}”
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
