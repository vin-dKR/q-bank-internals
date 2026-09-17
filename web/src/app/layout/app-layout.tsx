import type { JSX } from 'react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { IconDroplet, IconEdit, IconFileText, IconImage, IconLayers, IconScan } from '../../shared/ui/index.js';

/** localStorage key remembering whether the operator collapsed the sidebar. */
const SIDEBAR_KEY = 'ingest:sidebarCollapsed';

/** Read the persisted collapsed state; defaults to expanded and never throws if storage is blocked. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    // Storage unavailable (private mode / disabled) — fall back to the expanded default.
    return false;
  }
}

/** Persist the collapsed state; silently no-ops if storage is unavailable. */
function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage unavailable — the choice just won't survive this reload; nothing to recover.
    return;
  }
}

/** Minimal line icons (inline so there are no asset/CSP dependencies). */
function IconPanelLeft(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

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
  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium no-underline transition-colors [&>svg]:size-[18px] [&>svg]:flex-none';

/** Collapsed rail: icon centered in a square target, no label. */
const NAV_RAIL =
  'flex items-center justify-center rounded-lg p-2 no-underline transition-colors [&>svg]:size-[18px] [&>svg]:flex-none';

/** Build the NavLink class callback; layout differs between the full sidebar and the collapsed rail. */
function navClass(collapsed: boolean): (state: { isActive: boolean }) => string {
  const base = collapsed ? NAV_RAIL : NAV_BASE;
  return ({ isActive }) =>
    `${base} ${isActive ? 'bg-brand-soft text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`;
}

type NavItemProps = {
  to: string;
  end?: boolean;
  icon: JSX.Element;
  label: string;
  collapsed: boolean;
};

/** A single sidebar link: icon + label expanded, icon-only with a tooltip when collapsed. */
function NavItem({ to, end = false, icon, label, collapsed }: NavItemProps): JSX.Element {
  return (
    <NavLink
      to={to}
      end={end}
      className={navClass(collapsed)}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

/**
 * A sidebar entry that points to an EXTERNAL site, opening in a new tab. `NavItem`/`NavLink` only
 * handle in-app routes, so this renders a plain anchor styled to match. Used for tools that live on
 * another site (e.g. the watermark remover) — the app just links out, all work happens there.
 */
function ExternalNavItem({
  href,
  icon,
  label,
  collapsed,
}: {
  href: string;
  icon: JSX.Element;
  label: string;
  collapsed: boolean;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={navClass(collapsed)({ isActive: false })}
      title={collapsed ? label : `${label} — opens in a new tab`}
      aria-label={`${label} — opens in a new tab`}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </a>
  );
}

/** A group heading: uppercase caption expanded, a short centered rule in the collapsed rail. */
function SectionCaption({ label, collapsed }: { label: string; collapsed: boolean }): JSX.Element {
  if (collapsed) {
    return <div className="mx-auto my-2 h-px w-6 bg-line max-[820px]:hidden" aria-hidden="true" />;
  }
  return (
    <div className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3 max-[820px]:hidden">
      {label}
    </div>
  );
}

/** The shell every page renders inside: a persistent sidebar + the routed content canvas. */
export function AppLayout(): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  function toggleSidebar(): void {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }

  return (
    <div
      className={`grid min-h-screen max-[820px]:grid-cols-1 ${
        collapsed ? 'grid-cols-[64px_minmax(0,1fr)]' : 'grid-cols-[248px_minmax(0,1fr)]'
      }`}
    >
      <aside
        className={`sticky top-0 flex h-screen flex-col gap-0.5 border-r border-line bg-surface max-[820px]:static max-[820px]:h-auto max-[820px]:flex-row max-[820px]:flex-wrap max-[820px]:items-center max-[820px]:border-b max-[820px]:border-r-0 max-[820px]:p-3 ${
          collapsed ? 'p-2' : 'p-3'
        }`}
      >
        <div
          className={`mb-1 flex items-center py-1 ${
            collapsed ? 'flex-col gap-2' : 'gap-2.5 px-1.5'
          }`}
        >
          <div className="grid size-8 flex-none place-items-center rounded-lg bg-[linear-gradient(140deg,var(--color-brand),#7c6cf0)] text-sm font-bold text-white">
            E
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Eduents Ingest</div>
              <div className="text-xs text-ink-3">PDF → question bank</div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`grid size-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink max-[820px]:hidden [&>svg]:size-[18px] ${
              collapsed ? '' : 'ml-auto'
            }`}
          >
            <IconPanelLeft />
          </button>
        </div>

        <SectionCaption label="Pipeline" collapsed={collapsed} />
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavItem to="/" end icon={<IconScissors />} label="Cut & upload" collapsed={collapsed} />
          <NavItem to="/sessions" icon={<IconLayers />} label="Sessions & extraction" collapsed={collapsed} />
          <NavItem to="/verify" icon={<IconCheck />} label="Fix, verify & publish" collapsed={collapsed} />
        </nav>

        <SectionCaption label="Question bank" collapsed={collapsed} />
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavItem to="/questions" icon={<IconQuestions />} label="Questions" collapsed={collapsed} />
        </nav>

        <SectionCaption label="Masters" collapsed={collapsed} />
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavItem to="/masters/taxonomy" icon={<IconMasters />} label="Question taxonomy" collapsed={collapsed} />
          <NavItem to="/masters/exam-access" icon={<IconLayers />} label="Exam access" collapsed={collapsed} />
          <NavItem to="/prompts" icon={<IconFileText />} label="AI prompts" collapsed={collapsed} />
        </nav>

        <SectionCaption label="Tools" collapsed={collapsed} />
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavItem to="/tools/chapters" icon={<IconFileText />} label="Chapter Splitter" collapsed={collapsed} />
          <NavItem to="/tools/cut" icon={<IconScissors />} label="PDF Page Cutter" collapsed={collapsed} />
          <NavItem to="/tools/qna" icon={<IconScan />} label="QnA PDF Generator" collapsed={collapsed} />
          <NavItem to="/tools/rename" icon={<IconImage />} label="Image Renamer" collapsed={collapsed} />
          <NavItem to="/tools/edit" icon={<IconEdit />} label="Pdf Editor" collapsed={collapsed} />
          <ExternalNavItem
            href="https://pdf-watermark-remover-black.vercel.app/"
            icon={<IconDroplet />}
            label="Watermark Remover"
            collapsed={collapsed}
          />
        </nav>

        <div className="flex-1 max-[820px]:hidden" />

        <SectionCaption label="System" collapsed={collapsed} />
        <nav className="flex flex-col gap-0.5 max-[820px]:flex-row">
          <NavItem to="/usage" icon={<IconGauge />} label="Token usage" collapsed={collapsed} />
        </nav>

        {!collapsed && (
          <div className="mt-3 border-t border-line px-2 py-3 text-xs text-ink-3 max-[820px]:hidden">
            Phase 1 fills sessions · Phase 2 extracts them.
          </div>
        )}
      </aside>

      <div className="min-w-0">
        <main className="w-full py-8 pl-6 pr-6 lg:pl-10 lg:pr-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
