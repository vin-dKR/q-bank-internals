import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type BoxRect, DraggableBox } from './draggable-box.js';
import { IconButton } from './icon-button.js';
import { IconX, IconZoomIn, IconZoomOut } from './icons.js';
import { Spinner } from './spinner.js';

export type CanvasBox = BoxRect & {
  id: string;
  label: string;
  /** `ai` = unconfirmed suggestion, `saved` = crop attached to its question. Defaults to `manual`. */
  variant?: 'manual' | 'ai' | 'saved';
  /** Pulses the box while its crop is uploading. */
  busy?: boolean;
  /** Briefly rings the box to draw the eye to it (e.g. after "Edit crop" re-selects it). */
  flash?: boolean;
};
export type CanvasSize = {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
};

/** Smaller than this (display px) counts as a stray click, not a drawn region. */
const MIN_DRAW_SIZE = 10;

/**
 * Hover magnifier (Amazon-style): how far it enlarges the fitted page, the biggest square side (px) the
 * zoom panel is allowed to take, its smallest side, and the gap it keeps from the image. The panel is
 * sized to the image height (capped to LENS_MAX) so it reads like a second, enlarged copy beside it.
 */
const LENS_ZOOM = 2.4;
const LENS_MAX = 480;
const LENS_MIN = 240;
const LENS_GAP = 12;

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
  /** Live rubber-band rect during a draw (display pixels), or `null` when no draw is in progress. */
  onDrawProgress?: (rect: BoxRect | null) => void;
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
  onDrawProgress,
  onDrawCancel,
  onBoxGrab,
  onBoxRelease,
}: CropCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // The page image is fetched from Drive (via the API proxy) and can take a beat; show a loader until
  // it resolves. The same <img> element is reused across page changes, so reset on every src change —
  // `onLoad` only fires for the new load.
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); }, [imageSrc]);

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
    setLoading(false);
  };
  // A failed load must still clear the loader, or the spinner would spin forever on a broken page.
  const onError = (): void => { setLoading(false); };

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

  // --- Hover magnifier: an Amazon-style zoom panel beside the page (off while drawing a crop) ---
  // `lensPos` is the cursor in frame (display) pixels; the panel + on-image highlight derive from it.
  const [lensOn, setLensOn] = useState(true);
  const [lensPos, setLensPos] = useState<{ x: number; y: number } | null>(null);

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
    const rect = { x: point.x, y: point.y, width: 0, height: 0 };
    setRubber(rect);
    onDrawProgress?.(rect);
  };

  useEffect(() => {
    if (!draw) {
      drawStart.current = null;
      setRubber(null);
      onDrawProgress?.(null);
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
      const rect = toRect(drawStart.current, framePoint(event.clientX, event.clientY));
      setRubber(rect);
      onDrawProgress?.(rect);
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      if (!drawStart.current) return;
      const rect = toRect(drawStart.current, framePoint(event.clientX, event.clientY));
      drawStart.current = null;
      setRubber(null);
      onDrawProgress?.(null);
      // A stray click stays armed so the operator can simply try the drag again.
      if (rect.width >= MIN_DRAW_SIZE && rect.height >= MIN_DRAW_SIZE) onDraw?.(rect);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [draw, onDraw, onDrawProgress, framePoint]);

  const frameStyle: CSSProperties =
    displayWidth > 0 && displayHeight > 0 ? { width: displayWidth, height: displayHeight } : {};

  // Amazon-style hover zoom: a square highlight over the source region + a large panel showing it
  // enlarged, floated to the right of the image (flipped left when the viewport can't hold it there).
  // The panel is `position: fixed` and portalled to <body> so it escapes the canvas' `overflow: hidden`
  // and can overlay whatever sits beside the page. Recomputed each hover render from the frame's rect.
  const magnifier: { panel: CSSProperties; highlight: CSSProperties } | null = (() => {
    if (!lensOn || !lensPos || draw || loading || displayWidth <= 0 || displayHeight <= 0) return null;
    const frameEl = frameRef.current;
    if (!frameEl) return null;
    const rect = frameEl.getBoundingClientRect();
    const side = Math.max(LENS_MIN, Math.min(LENS_MAX, Math.round(displayHeight)));
    const win = side / LENS_ZOOM; // the source region (display px) the panel shows at LENS_ZOOM
    const hx = Math.min(Math.max(lensPos.x - win / 2, 0), Math.max(displayWidth - win, 0));
    const hy = Math.min(Math.max(lensPos.y - win / 2, 0), Math.max(displayHeight - win, 0));
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;
    const toRight = rect.right + LENS_GAP;
    const left = toRight + side <= viewportW ? toRight : Math.max(LENS_GAP, rect.left - LENS_GAP - side);
    const top = Math.min(Math.max(rect.top, LENS_GAP), Math.max(LENS_GAP, viewportH - side - LENS_GAP));
    return {
      panel: {
        left,
        top,
        width: side,
        height: side,
        backgroundImage: `url("${imageSrc}")`,
        backgroundSize: `${String(displayWidth * LENS_ZOOM)}px ${String(displayHeight * LENS_ZOOM)}px`,
        backgroundPosition: `${String(-hx * LENS_ZOOM)}px ${String(-hy * LENS_ZOOM)}px`,
      },
      highlight: { left: hx, top: hy, width: win, height: win },
    };
  })();

  return (
    <div ref={containerRef} className={draw ? 'crop-canvas crop-canvas--draw' : 'crop-canvas'}>
      {loading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-ink-3" role="status">
          <Spinner className="text-2xl" />
          <span className="text-sm">Loading page…</span>
        </div>
      ) : null}
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
      <div
        ref={frameRef}
        className="crop-canvas__frame"
        style={frameStyle}
        onMouseMove={(event) => {
          if (draw || !lensOn) return;
          setLensPos(framePoint(event.clientX, event.clientY));
        }}
        onMouseLeave={() => { setLensPos(null); }}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Source page"
          draggable={false}
          className="crop-canvas__img"
          onLoad={onLoad}
          onError={onError}
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
            flash={box.flash ?? false}
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
        {/* Amazon-style magnifier: a square marks the region under the cursor; the enlarged view of it
            renders in a portalled panel beside the image (below). Suppressed while drawing a crop. */}
        {magnifier ? <div className="crop-canvas__lens-area" style={magnifier.highlight} /> : null}
      </div>
      {magnifier
        ? createPortal(<div className="crop-canvas__zoom" style={magnifier.panel} />, document.body)
        : null}
      {!draw && !loading ? (
        <button
          type="button"
          className="crop-canvas__lens-toggle btn btn--ghost btn--icon-only btn--icon-only-sm"
          aria-pressed={lensOn}
          title={lensOn ? 'Turn off hover zoom' : 'Turn on hover zoom'}
          onClick={() => { setLensOn((on) => !on); }}
        >
          {lensOn ? <IconZoomIn /> : <IconZoomOut />}
        </button>
      ) : null}
    </div>
  );
}
