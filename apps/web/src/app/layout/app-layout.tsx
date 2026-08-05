import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

/** Minimal line icons (inline so there are no asset/CSP dependencies). */
function IconScissors(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function IconLayers(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function IconCheck(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconWrench(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.7-.5-.5-2.7 2.6-2.6Z" />
    </svg>
  );
}

function IconMasters(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

function IconGauge(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="m13.4 12.6 4-4" />
      <path d="M4 20a8 8 0 1 1 16 0Z" />
    </svg>
  );
}

/** The shell every page renders inside: a persistent sidebar + the routed content canvas. */
export function AppLayout(): JSX.Element {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__mark">E</div>
          <div>
            <div className="sidebar__title">Eduents Ingest</div>
            <div className="sidebar__subtitle">PDF → question bank</div>
          </div>
        </div>

        <div className="sidebar__section">Pipeline</div>
        <nav className="sidebar__nav">
          <NavLink to="/" end className="nav-item">
            <IconScissors />
            Cut &amp; upload
          </NavLink>
          <NavLink to="/sessions" className="nav-item">
            <IconLayers />
            Sessions
          </NavLink>
          <NavLink to="/verify" className="nav-item">
            <IconCheck />
            Verify
          </NavLink>
          <NavLink to="/bank" className="nav-item">
            <IconWrench />
            Fix bank images
          </NavLink>
          <NavLink to="/usage" className="nav-item">
            <IconGauge />
            Token usage
          </NavLink>
        </nav>

        <div className="sidebar__section">Masters</div>
        <nav className="sidebar__nav">
          <NavLink to="/masters" className="nav-item">
            <IconMasters />
            All masters
          </NavLink>
        </nav>

        <div className="sidebar__spacer" />
        <div className="sidebar__foot">Phase 1 fills sessions · Phase 2 extracts them.</div>
      </aside>

      <div className="content">
        <main className="content__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
