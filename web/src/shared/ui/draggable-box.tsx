import { type JSX, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

type Dir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

export type BoxRect = { x: number; y: number; width: number; height: number };

type DraggableBoxProps = BoxRect & {
  id: string;
  label: string;
  onUpdate: (id: string, rect: Partial<BoxRect>) => void;
  onDelete: (id: string) => void;
  /** Zoom factor the box is rendered under, so pointer deltas map back to unscaled box coords. */
  scale?: number;
  /** Visual style: `ai` marks an unconfirmed AI-suggested crop (distinct colour). */
  variant?: 'manual' | 'ai';
};

const HANDLES: { dir: Dir; cursor: string; style: React.CSSProperties }[] = [
  { dir: 'nw', cursor: 'nw-resize', style: { top: -4, left: -4 } },
  { dir: 'ne', cursor: 'ne-resize', style: { top: -4, right: -4 } },
  { dir: 'sw', cursor: 'sw-resize', style: { bottom: -4, left: -4 } },
  { dir: 'se', cursor: 'se-resize', style: { bottom: -4, right: -4 } },
  { dir: 'n', cursor: 'n-resize', style: { top: -4, left: '50%', transform: 'translateX(-50%)' } },
  { dir: 's', cursor: 's-resize', style: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
  { dir: 'w', cursor: 'w-resize', style: { top: '50%', left: -4, transform: 'translateY(-50%)' } },
  { dir: 'e', cursor: 'e-resize', style: { top: '50%', right: -4, transform: 'translateY(-50%)' } },
];

/** A draggable + 8-way resizable bounding box over the page image. Ported from multiCrop's DraggableBox. */
export function DraggableBox({
  id,
  x,
  y,
  width,
  height,
  label,
  onUpdate,
  onDelete,
  scale = 1,
  variant = 'manual',
}: DraggableBoxProps): JSX.Element {
  const dragging = useRef(false);
  const resizing = useRef<Dir | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const initial = useRef<BoxRect>({ x, y, width, height });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [active, setActive] = useState(false);

  const beginDrag = useCallback(
    (event: MouseEvent) => {
      if ((event.target as HTMLElement).classList.contains('cropbox__handle')) return;
      event.preventDefault();
      event.stopPropagation();
      dragging.current = true;
      setActive(true);
      start.current = { x: event.clientX, y: event.clientY };
      initial.current = { x, y, width, height };
    },
    [x, y, width, height],
  );

  const beginResize = useCallback(
    (event: MouseEvent, dir: Dir) => {
      event.preventDefault();
      event.stopPropagation();
      resizing.current = dir;
      setActive(true);
      start.current = { x: event.clientX, y: event.clientY };
      initial.current = { x, y, width, height };
    },
    [x, y, width, height],
  );

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent): void => {
      // Divide screen-pixel movement by the zoom so the box tracks the cursor 1:1 while zoomed.
      const dx = (event.clientX - start.current.x) / scaleRef.current;
      const dy = (event.clientY - start.current.y) / scaleRef.current;
      const base = initial.current;
      if (dragging.current) {
        onUpdate(id, { x: base.x + dx, y: base.y + dy });
      } else if (resizing.current) {
        const dir = resizing.current;
        const next: Partial<BoxRect> = {};
        if (dir.includes('w')) { next.x = base.x + dx; next.width = base.width - dx; }
        if (dir.includes('e')) { next.width = base.width + dx; }
        if (dir.includes('n')) { next.y = base.y + dy; next.height = base.height - dy; }
        if (dir.includes('s')) { next.height = base.height + dy; }
        if (next.width !== undefined && next.width < 24) {
          if (next.x !== undefined) next.x = base.x + base.width - 24;
          next.width = 24;
        }
        if (next.height !== undefined && next.height < 24) {
          if (next.y !== undefined) next.y = base.y + base.height - 24;
          next.height = 24;
        }
        onUpdate(id, next);
      }
    };
    const onUp = (): void => {
      dragging.current = false;
      resizing.current = null;
      setActive(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [id, onUpdate]);

  return (
    <div
      className={variant === 'ai' ? 'cropbox cropbox--ai' : 'cropbox'}
      onMouseDown={beginDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        if (window.confirm('Delete this region?')) onDelete(id);
      }}
      style={{ left: x, top: y, width, height }}
    >
      {!active ? <span className="cropbox__label">{label}</span> : null}
      {HANDLES.map(({ dir, cursor, style }) => (
        <span
          key={dir}
          className="cropbox__handle"
          onMouseDown={(event) => { beginResize(event, dir); }}
          style={{ cursor, ...style }}
        />
      ))}
    </div>
  );
}
