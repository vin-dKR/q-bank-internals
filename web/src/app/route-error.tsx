import type { JSX } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ErrorFallback } from '../shared/ui/index.js';

/** Turn whatever react-router threw into a human sentence for the fallback's quiet detail line. */
function messageOf(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${String(error.status)} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The router's app-wide safety net (`errorElement`). Any error that escapes a page — a loader
 * failure, or a render/effect throw no nearer boundary caught — lands here as a calm, reloadable
 * panel instead of react-router's raw stack trace. The reported crash (react-pdf's `getPage` on a
 * torn-down transport) is caught closer, inside `PdfPreviewer`; this covers everything else.
 */
export function RouteError(): JSX.Element {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <ErrorFallback
        fullBleed
        detail={messageOf(error)}
        retryLabel="Reload page"
        onRetry={() => {
          window.location.reload();
        }}
      />
    </div>
  );
}
