import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type BoxRect, DraggableBox } from './draggable-box.js';
import { IconButton } from './icon-button.js';
import { IconX } from './icons.js';

export type CanvasBox = BoxRect & {
  id: string;
  label: string;
  /** `ai` = unconfirmed suggestion, `saved` = crop attached to its question. Defaults to `manual`. */
  variant?: 'manual' | 'ai' | 'saved';
  /** Pulses the box while its crop is uploading. */
  busy?: boolean;
};
export type CanvasSize = {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
};

/** Smaller than this (display px) counts as a stray click, not a drawn region. */
const MIN_DRAW_SIZE = 10;

type CropCanvasProps = {
  imageSrc: string;
  boxes: CanvasBox[];
  onUpdateBox: (id: string, rect: Partial<BoxRect>) => void;
  onDeleteBox: (id: string) => void;
  onSize: (size: CanvasSize) => void;
  /** When set, the canvas is in draw mode: a rubber-band drag creates a region for this target. */
  draw?: { label: string } | null;
  /** A rubber-band drag finished — `rect` is the drawn region in display pixels. */
  onDraw?: (rect: BoxRect) => void;
  /** The operator dismissed draw mode from the canvas hint. */
  onDrawCancel?: () => void;
  /** A drag/resize on an existing box started — lets the owner snapshot state for undo. */
  onBoxGrab?: (id: string) => void;
  /** A drag/resize on an existing box ended; `moved` is false when the rect never changed. */
  onBoxRelease?: (id: string, moved: boolean) => void;
};

/**
 * The left pane: the page image with draggable/resizable crop regions drawn over it. The whole page is
 * fit inside the available frame (`scale = min(frameW/pageW, frameH/pageH)`, contain-fit) so it is
 * always fully visible — no scrolling, no zoom — matching the school-test viewer. The frame is sized to
 * the fitted pixels and the image fills it, so the box coordinate space is exactly those display pixels
 * and the display↔natural crop maths key off it. A ResizeObserver re-fits when the column resizes.
 *
 * With `draw` set, an overlay captures a rubber-band drag and reports the drawn rect via `onDraw` —
 * the auto-save crop flow's entry point.
 */
export function CropCanvas({
  imageSrc,
  boxes,
  onUpdateBox,
  onDeleteBox,
  onSize,
  draw = null,
  onDraw,
  onDrawCancel,
  onBoxGrab,
  onBoxRelease,
}: CropCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = (): void => { setFrame({ width: el.clientWidth, height: el.clientHeight }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  const onLoad = (): void => {
    const el = imgRef.current;
    if (el) setNatural({ width: el.naturalWidth, height: el.naturalHeight });
  };

  // Contain-fit: the largest uniform scale that keeps the whole page inside the frame.
  const scale =
    natural && frame.width > 0 && frame.height > 0 && natural.width > 0 && natural.height > 0
      ? Math.min(frame.width / natural.width, frame.height / natural.height)
      : null;
  const displayWidth = natural && scale ? natural.width * scale : 0;
  const displayHeight = natural && scale ? natural.height * scale : 0;

  // Publish the fitted size so the workspace can map display pixels ↔ natural pixels for cropping.
  useEffect(() => {
    if (natural && displayWidth > 0 && displayHeight > 0) {
      onSize({
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        displayWidth,
        displayHeight,
      });
    }
  }, [natural, displayWidth, displayHeight, onSize]);

  // --- Rubber-band drawing (draw mode only) ---
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const [rubber, setRubber] = useState<BoxRect | null>(null);

  const framePoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max(clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(clientY - rect.top, 0), rect.height),
    };
  }, []);

  const beginDraw = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const point = framePoint(event.clientX, event.clientY);
    drawStart.current = point;
    setRubber({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  useEffect(() => {
    if (!draw) {
      drawStart.current = null;
      setRubber(null);
      return undefined;
    }
    const toRect = (from: { x: number; y: number }, to: { x: number; y: number }): BoxRect => ({
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    });
    const onMove = (event: globalThis.MouseEvent): void => {
      if (!drawStart.current) return;
      setRubber(toRect(drawStart.current, framePoint(event.clientX, event.clientY)));
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      if (!drawStart.current) return;
      const rect = toRect(drawStart.current, framePoint(event.clientX, event.clientY));
      drawStart.current = null;
      setRubber(null);
      // A stray click stays armed so the operator can simply try the drag again.
      if (rect.width >= MIN_DRAW_SIZE && rect.height >= MIN_DRAW_SIZE) onDraw?.(rect);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [draw, onDraw, framePoint]);

  const frameStyle: CSSProperties =
    displayWidth > 0 && displayHeight > 0 ? { width: displayWidth, height: displayHeight } : {};

  return (
    <div ref={containerRef} className={draw ? 'crop-canvas crop-canvas--draw' : 'crop-canvas'}>
      {draw ? (
        <div className="crop-canvas__hint" role="status">
          <span>
            Draw a box — <b>{draw.label}</b>
          </span>
          <kbd>Esc</kbd>
          {onDrawCancel ? (
            <IconButton icon={<IconX />} label="Cancel drawing" size="sm" onClick={onDrawCancel} />
          ) : null}
        </div>
      ) : null}
      <div ref={frameRef} className="crop-canvas__frame" style={frameStyle}>
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Source page"
          draggable={false}
          className="crop-canvas__img"
          onLoad={onLoad}
        />
        {boxes.map((box) => (
          <DraggableBox
            key={box.id}
            id={box.id}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            label={box.label}
            variant={box.variant ?? 'manual'}
            busy={box.busy ?? false}
            scale={1}
            onUpdate={onUpdateBox}
            onDelete={onDeleteBox}
            onGrab={onBoxGrab}
            onRelease={onBoxRelease}
          />
        ))}
        {draw ? (
          <div className="crop-canvas__overlay" onMouseDown={beginDraw}>
            {rubber ? (
              <div
                className="crop-canvas__rubber"
                style={{ left: rubber.x, top: rubber.y, width: rubber.width, height: rubber.height }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
