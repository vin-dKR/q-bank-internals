import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { IconLayers } from '../../shared/ui/index.js';

/** Minimal line icons (inline so there are no asset/CSP dependencies). */
function IconScissors(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function IconCheck(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconWrench(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.7-.5-.5-2.7 2.6-2.6Z" />
    </svg>
  );
}

function IconMasters(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

function IconQuestions(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h13a2 2 0 0 1 2 2v14l-4-3H6a2 2 0 0 1-2-2Z" />
      <path d="M9.5 9a2 2 0 0 1 3.5 1.3c0 1.3-2 1.7-2 3" />
      <path d="M11 15.5h.01" />
    </svg>
  );
}

function IconGauge(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="m13.4 12.6 4-4" />
      <path d="M4 20a8 8 0 1 1 16 0Z" />
    </svg>
  );
}

const NAV_BASE =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors [&>svg]:size-[18px] [&>svg]:flex-none';

function navClass({ isActive }: { isActive: boolean }): string {
  return `${NAV_BASE} ${
    isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
  }`;
}

/** The shell every page renders inside: a persistent sidebar + the routed content canvas. */
export function AppLayout(): JSX.Element {
  return (
    <div className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)] max-[820px]:grid-cols-1">
      <aside className="sticky top-0 flex h-screen flex-col gap-1 border-r border-line bg-surface p-4 max-[820px]:static max-[820px]:h-auto max-[820px]:flex-row max-[820px]:flex-wrap max-[820px]:items-center max-[820px]:border-b max-[820px]:border-r-0">
        <div className="mb-2 flex items-center gap-2.5 px-2 py-1">
          <div className="grid size-8 flex-none place-items-center rounded-lg bg-[linear-gradient(140deg,var(--color-brand),#7c6cf0)] text-sm font-bold text-white">
            E
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Eduents Ingest</div>
            <div className="text-xs text-ink-3">PDF → question bank</div>
          </div>
        </div>

        <div className="px-2 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 max-[820px]:hidden">
          Pipeline
        </div>
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavLink to="/" end className={navClass}>
            <IconScissors />
            Cut &amp; upload
          </NavLink>
          <NavLink to="/tree" className={navClass}>
            <IconLayers />
            Cut &amp; upload v2
          </NavLink>
          <NavLink to="/sessions" className={navClass}>
            <IconLayers />
            Sessions
          </NavLink>
          <NavLink to="/verify" className={navClass}>
            <IconCheck />
            Verify
          </NavLink>
          <NavLink to="/questions" className={navClass}>
            <IconQuestions />
            Questions
          </NavLink>
          <NavLink to="/bank" className={navClass}>
            <IconWrench />
            Fix bank images
          </NavLink>
          <NavLink to="/usage" className={navClass}>
            <IconGauge />
            Token usage
          </NavLink>
        </nav>

        <div className="px-2 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 max-[820px]:hidden">
          Masters
        </div>
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavLink to="/masters" className={navClass}>
            <IconMasters />
            All masters
          </NavLink>
        </nav>

        <div className="flex-1 max-[820px]:hidden" />
        <div className="border-t border-line px-2 py-3 text-xs text-ink-3 max-[820px]:hidden">
          Phase 1 fills sessions · Phase 2 extracts them.
        </div>
      </aside>

      <div className="min-w-0">
        <main className="w-full px-6 py-8 lg:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
