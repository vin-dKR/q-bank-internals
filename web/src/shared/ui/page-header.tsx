import type { JSX, ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

/** The consistent title block at the top of every page: title + optional subtitle and actions. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line pb-5">
      {/* Shrinkable, with the subtitle wrapped at a readable line length instead of running the header's full
          width — so a long subtitle never squeezes or pushes down the actions beside it. */}
      <div className="flex min-w-0 flex-col gap-1">
        <h1>{title}</h1>
        {subtitle ? <p className="m-0 max-w-[62ch] text-pretty text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {/* Right-aligned, so a row that wraps on a narrow window stays under the actions, not adrift to the left. */}
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </header>
  );
}
