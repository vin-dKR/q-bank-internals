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
 * crammed into the toolbar as prose. The popover is `fixed`-positioned from the button's rect so the
 * toolbar's horizontal-scroll clipping can't cut it off; it closes on outside click, Escape, scroll,
 * or resize.
 */
export function ToolbarHelp({ children }: { children: ReactNode }): JSX.Element {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const open = anchor !== null;

  const toggle = (): void => {
    setAnchor((current) => {
      if (current) return null;
      const rect = ref.current?.getBoundingClientRect();
      return rect ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : null;
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = (): void => { setAnchor(null); };
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
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
        onClick={toggle}
      >
        <IconHelp />
      </button>
      {anchor ? (
        <div
          className="tbar__help-pop"
          role="dialog"
          style={{ position: 'fixed', top: anchor.top, right: anchor.right }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
