import {
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/cn.js';
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

/** Build a normalized rect (positive width/height) from two drag endpoints in display pixels. */
function rectFromPoints(from: { x: number; y: number }, to: { x: number; y: number }): BoxRect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * Drag-to-zoom. `LENS_MIN_SEL` is the smallest drag (display px, either axis) that counts as a region to zoom
 * into — anything less is a click. `OVERZOOM` caps the zoom at twice the page's native resolution: past that
 * a scan is only blurrier, not more legible. `ZOOM_FILL` leaves a margin so the chosen region never touches
 * the viewer's edges, and `ZOOM_STEP` is what the +/− buttons multiply by.
 */
const LENS_MIN_SEL = 8;
const OVERZOOM = 2;
const ZOOM_FILL = 0.92;
const ZOOM_STEP = 1.6;

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
  /** A non-editable source-region outline for a bank question. */
  focus?: { rect: BoxRect; label: string } | null;
};

/**
 * The left pane: the page image with draggable/resizable crop regions drawn over it. At rest the whole page
 * is fit inside the available frame (`scale = min(frameW/pageW, frameH/pageH)`, contain-fit). Dragging a box
 * on the bare page ZOOMS into it: the page is drawn `zoom` times larger inside a scrolling viewport, scrolled
 * so the chosen region fills the view, and stays there until "Fit page" (or Esc, or a double-click). The
 * frame is sized to the displayed pixels and the image fills it, so the box coordinate space is exactly
 * those display pixels — a zoom is just another display-size change, which the owner already rescales its
 * boxes for through `onSize`. A ResizeObserver on the (non-scrolling) outer box re-fits when the column
 * resizes.
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
  focus = null,
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
  // Zoom multiplies the fit. It is capped at OVERZOOM × native resolution, and never below the fit.
  const [zoom, setZoom] = useState(1);
  const maxZoom = scale ? Math.max(1, OVERZOOM / scale) : 1;
  const effectiveZoom = Math.min(zoom, maxZoom);
  const displayWidth = natural && scale ? natural.width * scale * effectiveZoom : 0;
  const displayHeight = natural && scale ? natural.height * scale * effectiveZoom : 0;
  const zoomed = effectiveZoom > 1.001;
  // A new page starts fitted: a zoom into page 3's diagram means nothing on page 4.
  useEffect(() => { setZoom(1); }, [imageSrc]);

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

  // --- Drag-to-zoom: press and drag on the bare page to rubber-band a region; on release the page zooms so
  // that region fills the viewer. `lensStart` holds the drag's origin (non-null only mid-drag, like the draw
  // rubber-band); `lensSel` is the live selection in frame (display) pixels, drawn as a marquee. ---
  const viewportRef = useRef<HTMLDivElement>(null);
  const lensStart = useRef<{ x: number; y: number } | null>(null);
  const [lensSel, setLensSel] = useState<BoxRect | null>(null);
  // Where to scroll once the zoomed size is laid out: the point (in the NEW display pixels) to centre.
  const pendingCentre = useRef<{ x: number; y: number } | null>(null);

  /** Zoom to `next`, keeping `focus` (current display pixels) at the centre of the viewer. */
  const zoomTo = useCallback(
    (next: number, focus: { x: number; y: number }): void => {
      const target = Math.min(Math.max(next, 1), maxZoom);
      const ratio = target / effectiveZoom;
      pendingCentre.current = { x: focus.x * ratio, y: focus.y * ratio };
      setZoom(target);
    },
    [maxZoom, effectiveZoom],
  );

  /** The centre of what the viewer shows now, in display pixels — the anchor for the +/− buttons. */
  const viewCentre = (): { x: number; y: number } => {
    const viewport = viewportRef.current;
    const frameEl = frameRef.current;
    if (!viewport || !frameEl) return { x: displayWidth / 2, y: displayHeight / 2 };
    const v = viewport.getBoundingClientRect();
    const f = frameEl.getBoundingClientRect();
    return { x: v.left + v.width / 2 - f.left, y: v.top + v.height / 2 - f.top };
  };

  const fitPage = useCallback((): void => {
    pendingCentre.current = null;
    setZoom(1);
  }, []);

  // After a zoom has laid out at its new size, scroll the chosen point to the middle of the viewer.
  useLayoutEffect(() => {
    const centre = pendingCentre.current;
    const viewport = viewportRef.current;
    if (!centre || !viewport) return;
    pendingCentre.current = null;
    viewport.scrollLeft = centre.x - viewport.clientWidth / 2;
    viewport.scrollTop = centre.y - viewport.clientHeight / 2;
  }, [displayWidth, displayHeight]);

  // Esc goes back to the whole page — unless a crop is being drawn, where Esc belongs to cancelling it.
  useEffect(() => {
    if (!zoomed || draw) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') fitPage();
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [zoomed, draw, fitPage]);

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
    const onMove = (event: globalThis.MouseEvent): void => {
      if (!drawStart.current) return;
      const rect = rectFromPoints(drawStart.current, framePoint(event.clientX, event.clientY));
      setRubber(rect);
      onDrawProgress?.(rect);
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      if (!drawStart.current) return;
      const rect = rectFromPoints(drawStart.current, framePoint(event.clientX, event.clientY));
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

  // A press-drag on the bare page rubber-bands a zoom region. A mousedown on a crop box (or resize
  // handle) stops propagation in DraggableBox, so this never fires there — box move/resize is
  // untouched, and the zoom only ever begins on the empty page. Suppressed while drawing a crop or loading.
  const beginLensDrag = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || draw || loading) return;
    event.preventDefault();
    const point = framePoint(event.clientX, event.clientY);
    lensStart.current = point;
    setLensSel({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  // Track the rubber-band at the document level so a fast drag — or one that slips past the frame edge —
  // keeps growing the selection, and a release anywhere ends it (mirrors the draw/box drag model). A real
  // region zooms the page so it fills the viewer; a click leaves the view alone.
  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent): void => {
      if (!lensStart.current) return;
      setLensSel(rectFromPoints(lensStart.current, framePoint(event.clientX, event.clientY)));
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      if (!lensStart.current) return;
      const sel = rectFromPoints(lensStart.current, framePoint(event.clientX, event.clientY));
      lensStart.current = null;
      setLensSel(null);
      const viewport = viewportRef.current;
      if (!viewport || sel.width < LENS_MIN_SEL || sel.height < LENS_MIN_SEL) return;
      const fill = Math.min(viewport.clientWidth / sel.width, viewport.clientHeight / sel.height) * ZOOM_FILL;
      zoomTo(effectiveZoom * fill, { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [framePoint, zoomTo, effectiveZoom]);

  const frameStyle: CSSProperties =
    displayWidth > 0 && displayHeight > 0 ? { width: displayWidth, height: displayHeight } : {};

  // The marquee shows the region being chosen while the drag is held; release zooms into it.
  const marquee: CSSProperties | null =
    lensSel && !draw && lensSel.width >= LENS_MIN_SEL && lensSel.height >= LENS_MIN_SEL
      ? { left: lensSel.x, top: lensSel.y, width: lensSel.width, height: lensSel.height }
      : null;

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
      {/* The viewport scrolls; the outer box does not, so the fit (measured on the outer box) never shifts
          when scrollbars appear at a zoom. */}
      <div ref={viewportRef} className={cn('crop-canvas__viewport', zoomed && 'crop-canvas__viewport--zoomed')}>
        <div
          ref={frameRef}
          className={cn('crop-canvas__frame', !draw && !loading && 'crop-canvas__frame--zoomable')}
          style={frameStyle}
          onMouseDown={beginLensDrag}
          onDoubleClick={(event) => {
            // A double-click on the page itself (not a crop box) goes back to the whole page.
            if (zoomed && !draw && event.target === imgRef.current) fitPage();
          }}
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
          {focus ? (
            <div
              className="crop-canvas__focus"
              aria-label={`Focused source region: ${focus.label}`}
              style={{
                left: focus.rect.x,
                top: focus.rect.y,
                width: focus.rect.width,
                height: focus.rect.height,
              }}
            >
              <span className="crop-canvas__focus-label">{focus.label}</span>
            </div>
          ) : null}
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
          {marquee ? <div className="crop-canvas__lens-area" style={marquee} /> : null}
        </div>
      </div>
      {!loading ? (
        <ZoomControls
          zoom={effectiveZoom}
          canZoomIn={effectiveZoom < maxZoom - 0.001}
          onZoomIn={() => { zoomTo(effectiveZoom * ZOOM_STEP, viewCentre()); }}
          onZoomOut={() => { zoomTo(effectiveZoom / ZOOM_STEP, viewCentre()); }}
          onFit={fitPage}
        />
      ) : null}
    </div>
  );
}

/**
 * The zoom buttons in the viewer's corner: zoom in/out around the middle of the view, and — once zoomed —
 * the level and a "Fit page" to go back. Shared by the question page and the answer/solution pane.
 */
export function ZoomControls({
  zoom,
  canZoomIn,
  onZoomIn,
  onZoomOut,
  onFit,
  placement = 'corner',
}: {
  zoom: number;
  canZoomIn: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** `corner` floats over the viewer; `inline` sits in a toolbar row. */
  placement?: 'corner' | 'inline';
}): JSX.Element {
  const zoomed = zoom > 1.001;
  return (
    <div
      className={placement === 'corner' ? 'crop-canvas__zoombar' : 'crop-canvas__zoombar--inline'}
      onMouseDown={(event) => { event.stopPropagation(); }}
    >
      {zoomed ? (
        <>
          <IconButton icon={<IconZoomOut />} label="Zoom out" size="sm" onClick={onZoomOut} />
          <span className="crop-canvas__zoomlevel">{Math.round(zoom * 100)}%</span>
        </>
      ) : null}
      <IconButton
        icon={<IconZoomIn />}
        label={zoomed ? 'Zoom in' : 'Zoom in — or drag a box on the page to zoom into it'}
        size="sm"
        disabled={!canZoomIn}
        onClick={onZoomIn}
      />
      {zoomed ? (
        <button type="button" className="crop-canvas__fit" onClick={onFit} title="Show the whole page (Esc)">
          Fit page
        </button>
      ) : null}
    </div>
  );
}
