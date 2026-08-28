import { type CSSProperties, type JSX, type MouseEvent, useEffect, useRef, useState } from 'react';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import { blockColor } from '../types/reflow-block.js';

type PdfReflowOverlayProps = {
  pageNumber: number;
  controller: ReflowController;
};

type Rect = { x0: number; y0: number; x1: number; y1: number };
/** The eight resize grips (corners + edge midpoints); `move` drags the whole box. */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type DragMode = 'move' | Handle;

const MIN_CROP = 0.02; // fraction — a drag smaller than this is a click, not a box

/** Corner/edge grips: id, its anchor within the box (%), and the resize cursor to show. */
const HANDLES: { id: Handle; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 50, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 100, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 100, y: 50, cursor: 'ew-resize' },
  { id: 'se', x: 100, y: 100, cursor: 'nwse-resize' },
  { id: 's', x: 50, y: 100, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 100, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 50, cursor: 'ew-resize' },
];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Left/top is always the smaller corner, so a box dragged inside-out still renders correctly. */
function normalize(r: Rect): Rect {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/** Apply a drag delta to the box: `move` shifts it (kept in bounds); a handle drags its edge(s). */
function applyDrag(mode: DragMode, start: Rect, dx: number, dy: number): Rect {
  if (mode === 'move') {
    let mx = dx;
    let my = dy;
    if (start.x0 + mx < 0) mx = -start.x0;
    if (start.x1 + mx > 1) mx = 1 - start.x1;
    if (start.y0 + my < 0) my = -start.y0;
    if (start.y1 + my > 1) my = 1 - start.y1;
    return { x0: start.x0 + mx, y0: start.y0 + my, x1: start.x1 + mx, y1: start.y1 + my };
  }
  const next = { ...start };
  if (mode.includes('w')) next.x0 = clamp01(start.x0 + dx);
  if (mode.includes('e')) next.x1 = clamp01(start.x1 + dx);
  if (mode.includes('n')) next.y0 = clamp01(start.y0 + dy);
  if (mode.includes('s')) next.y1 = clamp01(start.y1 + dy);
  return next;
}

/**
 * Reflow layer over a page: drag a rubber-band box to sketch a crop, then adjust it — drag the box
 * to move it, drag a corner/edge grip to resize — and confirm (✓ or Enter) to add it to the active
 * block, or cancel (✕ or Esc). A drawn box is never finalized on the first release; it stays editable
 * until confirmed. Existing crops are drawn as colour-coded, numbered boxes and can be removed. Crops
 * on several pages that share a block stack onto one page when applied.
 */
export function PdfReflowOverlay({ pageNumber, controller }: PdfReflowOverlayProps): JSX.Element {
  const { blocks, activeId, addCrop, removeCrop } = controller;
  const containerRef = useRef<HTMLDivElement>(null);
  const [rubber, setRubber] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ mode: DragMode; startX: number; startY: number; start: Rect } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const pointFor = (clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const commitDraft = (box: Rect | null): void => {
    setDraft(null);
    if (!box) return;
    const n = normalize(box);
    if (n.x1 - n.x0 < MIN_CROP || n.y1 - n.y0 < MIN_CROP) return; // too small to keep
    addCrop({ page: pageNumber, x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 });
  };

  const handleDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== containerRef.current) return;
    // Starting a fresh box on empty page area commits the box being edited, then begins the next.
    commitDraft(draft);
    const p = pointFor(event.clientX, event.clientY);
    if (!p) return;
    startRef.current = p;
    setRubber({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handleMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (!startRef.current) return;
    const p = pointFor(event.clientX, event.clientY);
    if (!p) return;
    const s = startRef.current;
    setRubber({ x0: s.x, y0: s.y, x1: p.x, y1: p.y });
  };

  const finishRubber = (): void => {
    const box = rubber;
    startRef.current = null;
    setRubber(null);
    if (!box) return;
    const n = normalize(box);
    if (n.x1 - n.x0 < MIN_CROP || n.y1 - n.y0 < MIN_CROP) return; // a click, not a drag
    setDraft(n); // stays editable — not finalized until confirmed
  };

  const startDrag = (event: MouseEvent<HTMLElement>, mode: DragMode): void => {
    if (event.button !== 0 || !draft) return;
    event.stopPropagation();
    const p = pointFor(event.clientX, event.clientY);
    if (!p) return;
    setDrag({ mode, startX: p.x, startY: p.y, start: draft });
  };

  // While a grip/box is being dragged, track the pointer on the window so a fast drag that leaves the
  // page doesn't drop the interaction.
  useEffect(() => {
    if (!drag) return;
    const onMove = (event: globalThis.MouseEvent): void => {
      const p = pointFor(event.clientX, event.clientY);
      if (!p) return;
      setDraft(applyDrag(drag.mode, drag.start, p.x - drag.startX, p.y - drag.startY));
    };
    const onUp = (): void => { setDrag(null); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  // Enter confirms the box under edit; Escape discards it.
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') { event.preventDefault(); commitDraft(draft); }
      else if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [draft]);

  const view = draft ? normalize(draft) : null;

  return (
    <div
      ref={containerRef}
      className="reflow-overlay"
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={finishRubber}
      onMouseLeave={() => { if (startRef.current) finishRubber(); }}
    >
      {blocks.map((block, bi) =>
        block.crops.map((crop, ci) => {
          if (crop.page !== pageNumber) return null;
          const style: CSSProperties = {
            left: `${String(crop.x0 * 100)}%`,
            top: `${String(crop.y0 * 100)}%`,
            width: `${String((crop.x1 - crop.x0) * 100)}%`,
            height: `${String((crop.y1 - crop.y0) * 100)}%`,
            borderColor: blockColor(bi),
            background: `${blockColor(bi)}1f`,
          };
          const total = block.crops.length;
          return (
            <div
              key={`${block.id}:${String(ci)}`}
              className={`reflow-crop ${block.id === activeId ? 'is-active' : ''}`}
              style={style}
            >
              <span className="reflow-crop__tag" style={{ background: blockColor(bi) }}>
                {bi + 1}
                {total > 1 ? ` · ${String(ci + 1)}/${String(total)}` : ''}
              </span>
              <button
                type="button"
                className="reflow-crop__remove"
                title="Remove this crop"
                onMouseDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); removeCrop(block.id, ci); }}
              >
                ×
              </button>
            </div>
          );
        }),
      )}

      {rubber ? (
        <div
          className="reflow-rubber"
          style={{
            left: `${String(Math.min(rubber.x0, rubber.x1) * 100)}%`,
            top: `${String(Math.min(rubber.y0, rubber.y1) * 100)}%`,
            width: `${String(Math.abs(rubber.x1 - rubber.x0) * 100)}%`,
            height: `${String(Math.abs(rubber.y1 - rubber.y0) * 100)}%`,
          }}
        />
      ) : null}

      {view ? (
        <div
          className="reflow-draft"
          style={{
            left: `${String(view.x0 * 100)}%`,
            top: `${String(view.y0 * 100)}%`,
            width: `${String((view.x1 - view.x0) * 100)}%`,
            height: `${String((view.y1 - view.y0) * 100)}%`,
          }}
          onMouseDown={(e) => { startDrag(e, 'move'); }}
        >
          <div className="reflow-draft__actions" onMouseDown={(e) => { e.stopPropagation(); }}>
            <button
              type="button"
              className="reflow-draft__btn reflow-draft__btn--ok"
              title="Add this crop (Enter)"
              onClick={() => { commitDraft(draft); }}
            >
              ✓
            </button>
            <button
              type="button"
              className="reflow-draft__btn reflow-draft__btn--cancel"
              title="Discard (Esc)"
              onClick={() => { setDraft(null); }}
            >
              ×
            </button>
          </div>
          {HANDLES.map((h) => (
            <span
              key={h.id}
              className="reflow-handle"
              style={{ left: `${String(h.x)}%`, top: `${String(h.y)}%`, cursor: h.cursor }}
              onMouseDown={(e) => { startDrag(e, h.id); }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
