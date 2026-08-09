import type { JSX, ReactNode } from 'react';
import { IconWarning } from './icons.js';
import { Button } from './button.js';

type ErrorFallbackProps = {
  title?: string;
  body?: ReactNode;
  /** The technical error message; rendered small and muted so operators can report it. */
  detail?: string | undefined;
  /** The single action that recovers — a labelled retry/reload. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  /** Fill the parent (centered in the whole content area) vs. sit inline as a card. */
  fullBleed?: boolean;
};

/**
 * The one designed error state: a warning glyph, a human sentence, the recovering action, and the
 * raw message kept quiet underneath. Used by {@link ErrorBoundary} and the router's errorElement so
 * a thrown error reads as a calm, recoverable panel — never a raw stack trace.
 */
export function ErrorFallback({
  title = 'Something went wrong',
  body = 'This view hit an unexpected error. You can try again — your other work is untouched.',
  detail,
  onRetry,
  retryLabel = 'Try again',
  fullBleed = false,
}: ErrorFallbackProps): JSX.Element {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-surface px-6 py-10 text-center ${
        fullBleed ? 'min-h-[60vh]' : ''
      }`}
    >
      <div className="mb-1 grid size-10 place-items-center rounded-full bg-warn-soft text-warn [&>svg]:size-5">
        <IconWarning />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      {body ? <p className="m-0 max-w-md text-sm text-ink-2">{body}</p> : null}
      {detail ? (
        <p className="m-0 mt-1 max-w-md break-words font-mono text-xs text-ink-3">{detail}</p>
      ) : null}
      {onRetry ? (
        <div className="mt-3">
          <Button variant="primary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
