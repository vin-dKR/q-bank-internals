import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

/** The shell every page renders inside: header + routed content. Owns no feature logic. */
export function AppLayout(): JSX.Element {
  return (
    <div className="shell">
      <header className="shell__header">
        <strong>Eduents Ingest</strong>
        <span className="muted">PDF → question bank pipeline</span>
        <nav className="shell__nav">
          <NavLink to="/" end>
            Cut &amp; upload
          </NavLink>
          <NavLink to="/verify">Verify</NavLink>
        </nav>
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
