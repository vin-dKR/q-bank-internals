import type { JSX } from 'react';

/** A spinning ring. Inherits `color` (via `currentColor`); size follows font-size. */
export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The one inline loading state — spinner + label — used wherever data is loading. */
export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-ink-2">
      <Spinner className="text-base text-ink-3" />
      {label}
    </div>
  );
}

/** A shimmering placeholder block for skeleton loading layouts. */
export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} aria-hidden="true" />;
}
