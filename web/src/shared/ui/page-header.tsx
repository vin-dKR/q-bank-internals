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
      <div className="flex flex-col gap-1">
        <h1>{title}</h1>
        {subtitle ? <p className="m-0 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
