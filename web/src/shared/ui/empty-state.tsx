import type { JSX, ReactNode } from 'react';

type EmptyStateProps = {
  /** An icon from `shared/ui/icons` shown in a muted circle above the title. */
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  /** The one action that fixes the emptiness (a button or button-styled link). */
  action?: ReactNode;
};

/**
 * The one designed empty state: what's missing, why, and the action that fixes it. A dashed border
 * separates "nothing here yet" from real content cards.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      {icon ? (
        <div className="mb-1 grid size-10 place-items-center rounded-full bg-surface-2 text-ink-3 [&>svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="text-[15px] font-semibold">{title}</div>
      {body ? <p className="m-0 max-w-md text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
