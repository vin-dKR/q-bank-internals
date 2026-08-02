import type { JSX } from 'react';
import { Outlet } from 'react-router-dom';

/** The shell every page renders inside: header + routed content. Owns no feature logic. */
export function AppLayout(): JSX.Element {
  return (
    <div className="shell">
      <header className="shell__header">
        <strong>Eduents Ingest</strong>
        <span className="muted">PDF → question bank pipeline</span>
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
