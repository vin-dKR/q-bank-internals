import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { IconTrash } from '../../../shared/ui/index.js';
import type { EditorElement } from '../types.js';

const MIN_W = 24;
const MIN_H = 16;

type Gesture =
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; startX: number; startY: number; origW: number; origH: number; origFont: number };

/**
 * One overlay element on a page: absolutely placed in base-px × `zoom`. Drag the body to move,
 * drag the corner to resize (text also scales its font), double-click text to edit. All deltas are
 * divided by `zoom` so the stored base-px geometry is zoom-independent (what export reads).
 */
export function EditorElement({
  element,
  zoom,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  element: EditorElement;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<EditorElement>) => void;
  onRemove: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    const move = (event: MouseEvent): void => {
      const g = gesture.current;
      if (!g) return;
      const dx = (event.clientX - g.startX) / zoom;
      const dy = (event.clientY - g.startY) / zoom;
      if (g.kind === 'move') {
        onChange({ x: g.origX + dx, y: g.origY + dy });
      } else {
        const w = Math.max(MIN_W, g.origW + dx);
        const h = Math.max(MIN_H, g.origH + dy);
        const patch: Partial<EditorElement> = { w, h };
        if (element.type === 'text' && g.origH > 0) {
          (patch as { fontSize?: number }).fontSize = Math.max(6, g.origFont * (h / g.origH));
        }
        onChange(patch);
      }
    };
    const up = (): void => { gesture.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [zoom, element.type, onChange]);

  const startMove = (event: ReactMouseEvent): void => {
    if (editing) return;
    event.stopPropagation();
    onSelect();
    gesture.current = { kind: 'move', startX: event.clientX, startY: event.clientY, origX: element.x, origY: element.y };
  };

  const startResize = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    onSelect();
    gesture.current = {
      kind: 'resize',
      startX: event.clientX,
      startY: event.clientY,
      origW: element.w,
      origH: element.h,
      origFont: element.type === 'text' ? element.fontSize : 0,
    };
  };

  const style: CSSProperties = {
    left: element.x * zoom,
    top: element.y * zoom,
    width: element.w * zoom,
    height: element.h * zoom,
  };

  return (
    <div
      style={style}
      onMouseDown={startMove}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      className={`absolute ${selected ? 'outline outline-2 outline-brand' : ''} ${editing ? 'cursor-text' : 'cursor-move'}`}
    >
      {element.type === 'text' ? (
        editing ? (
          <textarea
            autoFocus
            value={element.text}
            onChange={(event) => { onChange({ text: event.target.value }); }}
            onBlur={() => { setEditing(false); }}
            style={{ fontSize: element.fontSize * zoom, color: element.color, lineHeight: 1.15 }}
            className="h-full w-full resize-none border-none bg-white/80 p-0 outline-none"
          />
        ) : (
          <div
            onDoubleClick={() => { setEditing(true); }}
            style={{ fontSize: element.fontSize * zoom, color: element.color, lineHeight: 1.15 }}
            className="h-full w-full select-none overflow-hidden whitespace-pre-wrap break-words"
          >
            {element.text}
          </div>
        )
      ) : (
        <img src={element.dataUrl} alt="" className="pointer-events-none h-full w-full object-contain" />
      )}

      {selected ? (
        <>
          <span
            onMouseDown={startResize}
            className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white bg-brand"
            aria-hidden="true"
          />
          <button
            type="button"
            onMouseDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); onRemove(); }}
            aria-label="Delete element"
            className="absolute -right-2 -top-7 grid size-6 place-items-center rounded-md border border-line-strong bg-surface text-ink shadow-sm hover:bg-surface-2 [&>svg]:size-3.5"
          >
            <IconTrash />
          </button>
        </>
      ) : null}
    </div>
  );
}
