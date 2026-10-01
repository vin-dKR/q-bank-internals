import { useRef, useState, type JSX, type PointerEvent } from 'react';
import type { StructureCropBounds } from '@ingest/contracts';
import { cropBounds, moveCropBounds } from '../lib/structure-crops.js';
import type { StructureCropsController } from '../hooks/use-structure-crops.js';

type Point = { x: number; y: number };
type Gesture =
  | { kind: 'draw'; pointerId: number; start: Point }
  | { kind: 'move'; pointerId: number; start: Point; id: string; bounds: StructureCropBounds };
type Preview =
  | { kind: 'draw'; bounds: StructureCropBounds }
  | { kind: 'move'; id: string; bounds: StructureCropBounds };

export function StructureCropOverlay({
  pageNumber,
  controller,
  disabled,
}: {
  pageNumber: number;
  controller: StructureCropsController;
  disabled: boolean;
}): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const movable = controller.ready && !disabled && !controller.busy;
  const selectable = controller.mode !== 'none' && movable;
  const point = (event: PointerEvent<HTMLElement>): Point | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };
  const style = (
    box: StructureCropBounds,
  ): { left: string; top: string; width: string; height: string } => ({
    left: `${String(box.x0 * 100)}%`,
    top: `${String(box.y0 * 100)}%`,
    width: `${String((box.x1 - box.x0) * 100)}%`,
    height: `${String((box.y1 - box.y0) * 100)}%`,
  });
  const beginMove = (
    event: PointerEvent<HTMLElement>,
    id: string,
    bounds: StructureCropBounds,
  ): void => {
    event.stopPropagation();
    if (!movable || event.button !== 0) return;
    const start = point(event);
    if (!start) return;
    event.preventDefault();
    overlayRef.current?.setPointerCapture(event.pointerId);
    gesture.current = { kind: 'move', pointerId: event.pointerId, start, id, bounds };
  };
  const finish = (): void => {
    gesture.current = null;
    setPreview(null);
  };
  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20"
      style={{
        pointerEvents: selectable ? 'auto' : 'none',
        touchAction: movable ? 'none' : 'auto',
        cursor: selectable ? 'crosshair' : 'default',
      }}
      aria-label={`Heading crop selection for page ${String(pageNumber)}`}
      onPointerDown={(event) => {
        if (!selectable || event.button !== 0) return;
        const start = point(event);
        if (!start) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { kind: 'draw', pointerId: event.pointerId, start };
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        const current = point(event);
        if (!active || !current || active.pointerId !== event.pointerId || !movable) return;
        if (active.kind === 'move') {
          setPreview({
            kind: 'move',
            id: active.id,
            bounds: moveCropBounds(active.bounds, {
              x: current.x - active.start.x,
              y: current.y - active.start.y,
            }),
          });
        } else if (controller.mode !== 'none') {
          const bounds = cropBounds(controller.mode, active.start, current);
          setPreview(bounds ? { kind: 'draw', bounds } : null);
        }
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        const current = point(event);
        if (active && current && active.pointerId === event.pointerId && movable) {
          if (active.kind === 'move') {
            controller.setBounds(
              active.id,
              moveCropBounds(active.bounds, {
                x: current.x - active.start.x,
                y: current.y - active.start.y,
              }),
            );
          } else if (selectable && controller.mode !== 'none') {
            const bounds = cropBounds(controller.mode, active.start, current);
            if (bounds) controller.add(pageNumber, bounds);
          }
        }
        finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {controller.crops.map((crop, index) =>
        crop.pageNumber === pageNumber ? (
          <div
            key={crop.id}
            role="group"
            aria-label={`Heading crop ${String(index + 1)}`}
            className="absolute border-2 border-brand bg-brand/10"
            style={{
              ...style(
                preview?.kind === 'move' && preview.id === crop.id ? preview.bounds : crop.bounds,
              ),
              pointerEvents: movable ? 'auto' : 'none',
              cursor: movable ? 'grab' : 'default',
            }}
            onPointerDown={(event) => {
              beginMove(event, crop.id, crop.bounds);
            }}
          >
            <button
              type="button"
              className="absolute left-0 top-0 cursor-grab rounded-br bg-brand px-1.5 text-[12px] font-bold text-white"
              disabled={!movable}
              aria-label={`Move heading crop ${String(index + 1)}`}
              title="Drag to move; arrow keys also move the crop"
              onPointerDown={(event) => {
                beginMove(event, crop.id, crop.bounds);
              }}
              onKeyDown={(event) => {
                const offsets: Record<string, Point> = {
                  ArrowLeft: { x: -0.005, y: 0 },
                  ArrowRight: { x: 0.005, y: 0 },
                  ArrowUp: { x: 0, y: -0.005 },
                  ArrowDown: { x: 0, y: 0.005 },
                };
                const offset = offsets[event.key];
                if (!offset || !movable) return;
                event.preventDefault();
                event.stopPropagation();
                controller.setBounds(crop.id, moveCropBounds(crop.bounds, offset));
              }}
            >
              {index + 1} ↕
            </button>
            <button
              type="button"
              className="absolute right-0 top-0 rounded-bl bg-white px-1 text-red-600"
              disabled={!movable}
              aria-label={`Remove heading crop ${String(index + 1)}`}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                controller.remove(crop.id);
              }}
            >
              ×
            </button>
          </div>
        ) : null,
      )}
      {preview?.kind === 'draw' ? (
        <div
          className="absolute border-2 border-dashed border-brand bg-brand/15"
          style={{ ...style(preview.bounds), pointerEvents: 'none' }}
        />
      ) : null}
    </div>
  );
}
