import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { IconHelp } from './icons.js';

/**
 * One toolbar chrome for every workbench strip: a fixed-height, no-wrap row whose children are
 * grouped by function and separated by dividers. On narrow widths it scrolls horizontally rather
 * than wrapping into a ragged block. Compose with `ToolbarGroup`, `ToolbarDivider`, `ToolbarSpacer`.
 */
export function Toolbar({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div className="tbar" role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function ToolbarGroup({ children }: { children: ReactNode }): JSX.Element {
  return <div className="tbar__group">{children}</div>;
}

export function ToolbarDivider(): JSX.Element {
  return <span className="tbar__divider" aria-hidden="true" />;
}

export function ToolbarSpacer(): JSX.Element {
  return <span className="tbar__spacer" />;
}

/**
 * A `?` button that reveals help text in a popover — the home for interaction hints that used to be
 * crammed into the toolbar as prose. Closes on outside click or Escape.
 */
export function ToolbarHelp({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tbar__help" ref={ref}>
      <button
        type="button"
        className="btn btn--ghost btn--icon-only btn--icon-only-sm"
        aria-label="Interaction help"
        aria-expanded={open}
        title="Help"
        onClick={() => { setOpen((v) => !v); }}
      >
        <IconHelp />
      </button>
      {open ? <div className="tbar__help-pop" role="dialog">{children}</div> : null}
    </div>
  );
}
