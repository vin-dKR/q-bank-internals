import { type JSX, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';

type Dir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

export type BoxRect = { x: number; y: number; width: number; height: number };

type DraggableBoxProps = BoxRect & {
  id: string;
  label: string;
  onUpdate: (id: string, rect: Partial<BoxRect>) => void;
  onDelete: (id: string) => void;
  /** Fired when a drag/resize starts — lets the owner snapshot state for undo. */
  onGrab?: ((id: string) => void) | undefined;
  /** Fired when a drag/resize ends; `moved` is false for a click that never changed the rect. */
  onRelease?: ((id: string, moved: boolean) => void) | undefined;
  /** Zoom factor the box is rendered under, so pointer deltas map back to unscaled box coords. */
  scale?: number;
  /** Visual style: `ai` = unconfirmed AI suggestion, `saved` = crop attached to its question. */
  variant?: 'manual' | 'ai' | 'saved';
  /** Pulses the box while its crop is uploading. */
  busy?: boolean;
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
  onGrab,
  onRelease,
  scale = 1,
  variant = 'manual',
  busy = false,
}: DraggableBoxProps): JSX.Element {
  const dragging = useRef(false);
  const resizing = useRef<Dir | null>(null);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const initial = useRef<BoxRect>({ x, y, width, height });
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [active, setActive] = useState(false);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;

  const beginDrag = useCallback(
    (event: MouseEvent) => {
      if ((event.target as HTMLElement).classList.contains('cropbox__handle')) return;
      event.preventDefault();
      event.stopPropagation();
      dragging.current = true;
      moved.current = false;
      setActive(true);
      onGrab?.(id);
      start.current = { x: event.clientX, y: event.clientY };
      initial.current = { x, y, width, height };
    },
    [id, x, y, width, height, onGrab],
  );

  const beginResize = useCallback(
    (event: MouseEvent, dir: Dir) => {
      event.preventDefault();
      event.stopPropagation();
      resizing.current = dir;
      moved.current = false;
      setActive(true);
      onGrab?.(id);
      start.current = { x: event.clientX, y: event.clientY };
      initial.current = { x, y, width, height };
    },
    [id, x, y, width, height, onGrab],
  );

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent): void => {
      // Divide screen-pixel movement by the zoom so the box tracks the cursor 1:1 while zoomed.
      const dx = (event.clientX - start.current.x) / scaleRef.current;
      const dy = (event.clientY - start.current.y) / scaleRef.current;
      const base = initial.current;
      if (dragging.current) {
        if (dx !== 0 || dy !== 0) moved.current = true;
        onUpdate(id, { x: base.x + dx, y: base.y + dy });
      } else if (resizing.current) {
        if (dx !== 0 || dy !== 0) moved.current = true;
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
      if (!dragging.current && !resizing.current) return;
      dragging.current = false;
      resizing.current = null;
      setActive(false);
      releaseRef.current?.(id, moved.current);
      moved.current = false;
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
      className={cn(
        'cropbox',
        variant === 'ai' && 'cropbox--ai',
        variant === 'saved' && 'cropbox--saved',
        busy && 'cropbox--busy',
      )}
      onMouseDown={beginDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        onDelete(id);
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
