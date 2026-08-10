import { type JSX, useEffect, useState } from 'react';

/**
 * The keyword box over the browse list. Holds its own text and pushes it up debounced (300ms) so a
 * search fires once the operator pauses, not on every keystroke. Mirrors eduents' ≥2-char behaviour:
 * the server ignores anything shorter, so one or zero characters simply lists everything.
 */
export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const [text, setText] = useState(value);

  // Keep local text in sync when the value is cleared/replaced from outside (e.g. "Clear filters").
  useEffect(() => { setText(value); }, [value]);

  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => { onChange(text); }, 300);
    return () => { clearTimeout(id); };
  }, [text, value, onChange]);

  return (
    <input
      type="search"
      value={text}
      onChange={(event) => { setText(event.target.value); }}
      placeholder="Search questions by keyword…"
      aria-label="Search questions by keyword"
      className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
    />
  );
}
