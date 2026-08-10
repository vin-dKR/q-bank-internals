import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import type { SplitOrientation, SplitPoint } from '../types.js';

type Drag = { id: string; orientation: SplitOrientation };

/**
 * The click/drag layer over one rendered page. Left-click drops a horizontal cut line; right-click
 * drops a vertical guide. Lines drag to reposition and carry an × to remove. Positions are 0–1
 * fractions of the page box, so they survive zoom and map straight onto the PDF at export.
 */
export function SplitOverlay({
  page,
  splits,
  onAdd,
  onMove,
  onRemove,
}: {
  page: number;
  splits: SplitPoint[];
  onAdd: (page: number, position: number, orientation: SplitOrientation) => void;
  onMove: (id: string, position: number) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const addAt = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!ref.current || event.target !== ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    onAdd(page, y, 'horizontal');
  };

  const addGuide = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    onAdd(page, x, 'vertical');
  };

  useEffect(() => {
    if (!drag) return;
    const move = (event: MouseEvent): void => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const raw =
        drag.orientation === 'horizontal'
          ? (event.clientY - rect.top) / rect.height
          : (event.clientX - rect.left) / rect.width;
      onMove(drag.id, Math.max(0, Math.min(1, raw)));
    };
    const up = (): void => { setDrag(null); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, onMove]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair"
      onClick={addAt}
      onContextMenu={addGuide}
    >
      {splits.map((split) => {
        const horizontal = split.orientation === 'horizontal';
        const style = horizontal
          ? { top: `${String(split.position * 100)}%`, left: 0, right: 0, height: 2 }
          : { left: `${String(split.position * 100)}%`, top: 0, bottom: 0, width: 2 };
        return (
          <div
            key={split.id}
            style={style}
            className={`absolute ${
              horizontal ? 'cursor-row-resize bg-brand' : 'cursor-col-resize bg-ink-3/60'
            }`}
            onMouseDown={(event) => {
              event.stopPropagation();
              setDrag({ id: split.id, orientation: split.orientation });
            }}
          >
            <button
              type="button"
              onMouseDown={(event) => { event.stopPropagation(); }}
              onClick={(event) => { event.stopPropagation(); onRemove(split.id); }}
              aria-label="Remove line"
              className="absolute -top-2.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-surface text-xs leading-none text-ink shadow-sm hover:bg-surface-2"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
