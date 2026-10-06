import { type JSX, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconHelp, IconX } from './icons.js';
import { IconButton } from './icon-button.js';

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
export function ToolbarHelp({
  children,
  label = 'Interaction help',
  icon = <IconHelp />,
  width = 288,
  onOpen,
}: {
  children: ReactNode;
  label?: string;
  icon?: ReactNode;
  width?: number;
  onOpen?: () => void;
}): JSX.Element {
  const [anchor, setAnchor] = useState<{
    top: number | undefined;
    bottom: number | undefined;
    right: number;
    maxHeight: number;
    width: number;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = anchor !== null;

  const toggle = (): void => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const panelWidth = Math.min(width, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const placeBelow = below >= Math.min(280, above);
    onOpen?.();
    setAnchor({
      top: placeBelow ? rect.bottom + 4 : undefined,
      bottom: placeBelow ? undefined : window.innerHeight - rect.top + 4,
      right: Math.max(
        12,
        Math.min(window.innerWidth - panelWidth - 12, window.innerWidth - rect.right),
      ),
      maxHeight: Math.max(80, placeBelow ? below : above),
      width: panelWidth,
    });
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const close = (): void => {
      setAnchor(null);
    };
    const onDown = (event: MouseEvent): void => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      )
        close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    const onScroll = (event: Event): void => {
      if (!(event.target instanceof Node && panelRef.current?.contains(event.target))) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="tbar__help" ref={ref}>
      <button
        type="button"
        ref={buttonRef}
        className="btn btn--ghost btn--icon-only btn--icon-only-sm"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        title={label}
        onClick={toggle}
      >
        {icon}
      </button>
      {anchor
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="tbar__help-pop"
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              style={{
                position: 'fixed',
                ...anchor,
                top: anchor.top ?? 'auto',
                bottom: anchor.bottom ?? 'auto',
                overflowY: 'auto',
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{label}</span>
                <IconButton
                  icon={<IconX />}
                  label={`Close ${label}`}
                  size="xs"
                  onClick={() => {
                    setAnchor(null);
                    buttonRef.current?.focus({ preventScroll: true });
                  }}
                />
              </div>
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
