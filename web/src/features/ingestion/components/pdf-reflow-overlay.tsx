import { type CSSProperties, type JSX, type MouseEvent, useRef, useState } from 'react';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import { blockColor } from '../types/reflow-block.js';

type PdfReflowOverlayProps = {
  pageNumber: number;
  controller: ReflowController;
};

const MIN_CROP = 0.02; // fraction — a drag smaller than this is a click, not a box

/**
 * Reflow layer over a page: drag a rubber-band box to add a crop to the active block. Existing crops
 * are drawn as colour-coded boxes (one hue per block, numbered with their block + fragment) and can
 * be removed. Crops on several pages that share a block stack onto one page when applied.
 */
export function PdfReflowOverlay({ pageNumber, controller }: PdfReflowOverlayProps): JSX.Element {
  const { blocks, activeId, addCrop, removeCrop } = controller;
  const containerRef = useRef<HTMLDivElement>(null);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const pointFor = (event: MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handleDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== containerRef.current) return;
    const p = pointFor(event);
    if (!p) return;
    startRef.current = p;
    setRubber({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handleMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (!startRef.current) return;
    const p = pointFor(event);
    if (!p) return;
    const s = startRef.current;
    setRubber({
      x0: Math.min(s.x, p.x),
      y0: Math.min(s.y, p.y),
      x1: Math.max(s.x, p.x),
      y1: Math.max(s.y, p.y),
    });
  };

  const handleUp = (): void => {
    const box = rubber;
    startRef.current = null;
    setRubber(null);
    if (!box) return;
    if (box.x1 - box.x0 < MIN_CROP || box.y1 - box.y0 < MIN_CROP) return; // a click, not a drag
    addCrop({ page: pageNumber, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
  };

  return (
    <div
      ref={containerRef}
      className="reflow-overlay"
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={() => { if (startRef.current) handleUp(); }}
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
            left: `${String(rubber.x0 * 100)}%`,
            top: `${String(rubber.y0 * 100)}%`,
            width: `${String((rubber.x1 - rubber.x0) * 100)}%`,
            height: `${String((rubber.y1 - rubber.y0) * 100)}%`,
          }}
        />
      ) : null}
    </div>
  );
}
