import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type CanvasSize, IconButton, IconChevronLeft, IconChevronRight, IconSparkle, Spinner, ZoomControls } from '../../../shared/ui/index.js';
import { DraggableBox } from '../../../shared/ui/draggable-box.js';
import { questionsApi } from '../api/questions.api.js';
import { usePageCount } from '../hooks/use-questions.js';

type Rect = { x: number; y: number; width: number; height: number };

/** One durable sibling-PDF crop. `id` is stable within the pane and lets each boundary save itself. */
type ExistingCrop = {
  id: string;
  /** The attached media URL this boundary currently replaces. */
  url: string;
  rect: Rect;
  page: number;
  label: string;
};

/** A sibling-PDF drag projected into the same magnifier used by the main question page. */
export type SourcePreviewMagnifier = {
  imageSrc: string;
  box: Rect;
  size: CanvasSize;
  label: string;
};

/** Optional crop capability: when `armed`, a rubber-band draw on the previewed page reports its crop. */
type CropCapability = {
  armed: boolean;
  /** A box was drawn: `natural` is its rect in the page image's natural pixels. */
  onCrop: (imageUrl: string, natural: Rect, page: number) => void;
  /** The operator dismissed the armed crop (Esc). */
  onCancel: () => void;
  /** Every persisted crop for this sibling document, shown on its original page. */
  existingCrops?: readonly ExistingCrop[];
  /**
   * Saved sibling crops stay visible even when no new crop is armed. Releasing a
   * dragged/resized boundary replaces that existing crop in the parent record.
   */
  onExistingCrop?: (id: string, replacedUrl: string, imageUrl: string, natural: Rect, page: number) => string | null | Promise<string | null>;
};

/** One-page AI figure scan for this sibling source. The parent owns mapping + persistence. */
type DetectionCapability = {
  busy: boolean;
  onDetect: (page: number) => void;
  /** Overrides the compact icon's accessible label for a combined Answer + Solution source. */
  label?: string;
};

/** A combined companion is one PDF, but a crop/scan still has to land in the requested field. */
type DestinationCapability = {
  target: 'answer' | 'solution';
  onTargetChange: (target: 'answer' | 'solution') => void;
};

type ExistingSaveRun = { done: Promise<void> };

/** Smaller than this (display px) is a stray click, not a drawn region. */
const MIN_DRAW = 8;
const OVERZOOM = 2;
const ZOOM_FILL = 0.92;
const ZOOM_STEP = 1.6;
type Point = { x: number; y: number };

/**
 * A read-only preview of one sibling source PDF — the unit's answer or solution — shown beside the
 * question page in Verify. Owns its own page cursor: seeded to `defaultPage` (this topic's
 * answer/solution start) and re-seeded whenever that changes as the operator moves through the
 * question PDF, with prev/next nav so the answer/explanation can be checked against the question.
 *
 * With `crop.armed` set (the solution pane, while an explanation-image crop is armed) a rubber-band
 * overlay captures a drag on the page and reports the drawn region — the crop's entry point.
 * Otherwise a drag enlarges the selected region inside the pane until Fit page, Esc, or a double-click.
 */
export function SourcePreviewPane({
  title,
  tone,
  documentId,
  fileName,
  defaultPage,
  crop,
  detection,
  destination,
  onPageChange,
  onMagnifierChange,
}: {
  title: string;
  tone: 'answer' | 'solution';
  documentId: string;
  fileName: string;
  defaultPage: number;
  crop?: CropCapability;
  /** Optional Answer/Solution figure scan for the page currently displayed in this pane. */
  detection?: DetectionCapability;
  /** Compact field destination picker for a single grouped Answer + Solution companion source. */
  destination?: DestinationCapability;
  /** Reports the page currently displayed, so field re-extracts read what the operator is viewing. */
  onPageChange?: (page: number) => void;
  /** Receives a live sibling crop while it is drawn or adjusted; null clears the shared magnifier. */
  onMagnifierChange?: (value: SourcePreviewMagnifier | null) => void;
}): JSX.Element {
  const [page, setPage] = useState(defaultPage);
  useEffect(() => { setPage(defaultPage); }, [defaultPage]);
  // Keep the parent informed without putting a fresh callback identity in this effect's dependency
  // list. That lets Verify remember a manually navigated page for field re-extracts without a
  // report → render → report loop.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  useEffect(() => { onPageChangeRef.current?.(page); }, [page]);
  const pageCount = usePageCount(documentId);
  const totalPages = pageCount.data ?? 1;
  // Measure the fixed outer pane so zoom scrollbars never change the fitted size.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const update = (): void => {
      setViewport({ width: Math.max(0, element.clientWidth - 24), height: Math.max(0, element.clientHeight - 24) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);
  // Loader for the previewed page image (fetched from Drive via the API proxy). The <img> is reused
  // across page changes, so reset on every page change — `onLoad` fires only for the new load.
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); setNaturalSize(null); }, [page, documentId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [lens, setLens] = useState<Rect | null>(null);
  const lensStart = useRef<Point | null>(null);
  const pendingCentre = useRef<Point | null>(null);
  useEffect(() => {
    setZoom(1);
    setLens(null);
    lensStart.current = null;
    pendingCentre.current = null;
  }, [page, documentId]);

  // --- Rubber-band crop (only while `crop.armed`) ---
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rubber, setRubber] = useState<Rect | null>(null);
  const armed = crop?.armed ?? false;
  // Read the latest crop callbacks through a ref so the drag listeners never capture a stale closure
  // (the parent passes a fresh `crop` object each render).
  const cropRef = useRef(crop);
  cropRef.current = crop;
  // Each saved crop owns its own natural-pixel working rect. Keeping the map in a ref as well as
  // state is important: mouseup can occur before React has committed the last mousemove state update.
  const [editedNaturals, setEditedNaturals] = useState<ReadonlyMap<string, Rect>>(() => new Map());
  const editedNaturalsRef = useRef<ReadonlyMap<string, Rect>>(new Map());
  const [savingExistingIds, setSavingExistingIds] = useState<ReadonlySet<string>>(() => new Set());
  const savingExistingIdsRef = useRef<ReadonlySet<string>>(new Set());
  const existingSaveRuns = useRef(new Map<string, ExistingSaveRun>());
  // A re-crop creates a new media URL. Preserve it locally until the query cache re-renders the new
  // boundary id, so a second quick drag still replaces the image produced by the first drag.
  const localUrlsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const [activeExistingId, setActiveExistingId] = useState<string | null>(null);
  const existingCrops = crop?.existingCrops ?? [];
  const existingSignature = existingCrops
    .map((item) => `${item.id}:${item.url}:${String(item.page)}:${String(item.rect.x)}:${String(item.rect.y)}:${String(item.rect.width)}:${String(item.rect.height)}`)
    .join('|');
  useEffect(() => {
    const previous = editedNaturalsRef.current;
    const next = new Map<string, Rect>();
    let changed = previous.size !== existingCrops.length;
    for (const item of existingCrops) {
      // Keep a local drag in place until its replacement arrives from the query cache. A successful
      // re-crop gets a fresh URL/id, so the new persisted rect naturally replaces this entry.
      const current = previous.get(item.id) ?? item.rect;
      next.set(item.id, current);
      if (!previous.has(item.id)) changed = true;
    }
    if (!changed) return;
    editedNaturalsRef.current = next;
    setEditedNaturals(next);
  }, [existingSignature]);
  useEffect(() => {
    const previous = localUrlsRef.current;
    const next = new Map<string, string>();
    for (const item of existingCrops) next.set(item.id, previous.get(item.id) ?? item.url);
    localUrlsRef.current = next;
  }, [existingSignature]);
  const scale = naturalSize && viewport.width > 0 && viewport.height > 0
    ? Math.min(viewport.width / naturalSize.width, viewport.height / naturalSize.height)
    : null;
  const maxZoom = scale ? Math.max(1, OVERZOOM / scale) : 1;
  const effectiveZoom = Math.min(zoom, maxZoom);
  const zoomed = effectiveZoom > 1.001;
  const displayWidth = naturalSize && scale ? naturalSize.width * scale * effectiveZoom : 0;
  const displayHeight = naturalSize && scale ? naturalSize.height * scale * effectiveZoom : 0;

  const zoomTo = (next: number, focus: Point): void => {
    const target = Math.min(Math.max(next, 1), maxZoom);
    const ratio = target / effectiveZoom;
    pendingCentre.current = { x: focus.x * ratio, y: focus.y * ratio };
    setZoom(target);
  };
  const viewCentre = (): Point => {
    const scroller = scrollRef.current?.getBoundingClientRect();
    const image = imgRef.current?.getBoundingClientRect();
    if (!scroller || !image) return { x: 0, y: 0 };
    return { x: scroller.left + scroller.width / 2 - image.left, y: scroller.top + scroller.height / 2 - image.top };
  };
  const fitPage = (): void => {
    pendingCentre.current = null;
    setZoom(1);
  };
  useLayoutEffect(() => {
    const centre = pendingCentre.current;
    const scroller = scrollRef.current;
    const image = imgRef.current;
    if (!centre || !scroller || !image) return;
    pendingCentre.current = null;
    const s = scroller.getBoundingClientRect();
    const i = image.getBoundingClientRect();
    scroller.scrollLeft += i.left + centre.x - (s.left + s.width / 2);
    scroller.scrollTop += i.top + centre.y - (s.top + s.height / 2);
  }, [displayWidth, displayHeight]);

  const imgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max(clientX - r.left, 0), r.width),
      y: Math.min(Math.max(clientY - r.top, 0), r.height),
    };
  };
  const beginDraw = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    setActiveExistingId(null);
    startRef.current = imgPoint(event.clientX, event.clientY);
    setRubber({ ...startRef.current, width: 0, height: 0 });
  };

  const beginLens = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || armed || loading) return;
    event.preventDefault();
    lensStart.current = imgPoint(event.clientX, event.clientY);
    setLens({ ...lensStart.current, width: 0, height: 0 });
  };
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  const zoomRef = useRef(effectiveZoom);
  zoomRef.current = effectiveZoom;
  useEffect(() => {
    if (armed) {
      lensStart.current = null;
      setLens(null);
      return undefined;
    }
    const toRect = (a: Point, b: Point): Rect => ({
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
    });
    const onMove = (event: globalThis.MouseEvent): void => {
      if (lensStart.current) setLens(toRect(lensStart.current, imgPoint(event.clientX, event.clientY)));
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      const start = lensStart.current;
      if (!start) return;
      lensStart.current = null;
      setLens(null);
      const sel = toRect(start, imgPoint(event.clientX, event.clientY));
      const scroller = scrollRef.current;
      if (!scroller || sel.width < MIN_DRAW || sel.height < MIN_DRAW) return;
      const fill = Math.min(scroller.clientWidth / sel.width, scroller.clientHeight / sel.height) * ZOOM_FILL;
      zoomToRef.current(zoomRef.current * fill, { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        lensStart.current = null;
        setLens(null);
        pendingCentre.current = null;
        setZoom(1);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [armed]);

  useEffect(() => {
    if (!armed) {
      startRef.current = null;
      setRubber(null);
      return undefined;
    }
    const toRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    });
    const onMove = (event: globalThis.MouseEvent): void => {
      if (!startRef.current) return;
      setRubber(toRect(startRef.current, imgPoint(event.clientX, event.clientY)));
    };
    const onUp = (event: globalThis.MouseEvent): void => {
      const start = startRef.current;
      startRef.current = null;
      setRubber(null);
      if (!start) return;
      const rect = toRect(start, imgPoint(event.clientX, event.clientY));
      const el = imgRef.current;
      if (!el || rect.width < MIN_DRAW || rect.height < MIN_DRAW) return;
      const box = el.getBoundingClientRect();
      const scaleX = el.naturalWidth / box.width;
      const scaleY = el.naturalHeight / box.height;
      cropRef.current?.onCrop(questionsApi.pageImageUrl(documentId, page), {
        x: rect.x * scaleX,
        y: rect.y * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      }, page);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cropRef.current?.onCancel();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [armed, documentId, page]);

  const existingOnPage = existingCrops.filter((item) => item.page === page);
  const displayExisting = (() => {
    if (!naturalSize || displayWidth <= 0 || displayHeight <= 0) return [];
    return existingOnPage.map((item) => {
      const existing = editedNaturals.get(item.id) ?? item.rect;
      return {
        item,
        x: existing.x * displayWidth / naturalSize.width,
        y: existing.y * displayHeight / naturalSize.height,
        width: existing.width * displayWidth / naturalSize.width,
        height: existing.height * displayHeight / naturalSize.height,
      };
    });
  })();
  const activeExisting = activeExistingId
    ? displayExisting.find(({ item }) => item.id === activeExistingId)
    : undefined;
  const magnifierRect = rubber ?? (activeExisting
    ? { x: activeExisting.x, y: activeExisting.y, width: activeExisting.width, height: activeExisting.height }
    : null);
  const magnifierSignature = magnifierRect
    ? `${String(magnifierRect.x)}:${String(magnifierRect.y)}:${String(magnifierRect.width)}:${String(magnifierRect.height)}`
    : '';
  useEffect(() => {
    if (!onMagnifierChange || !magnifierRect || magnifierRect.width < 2 || magnifierRect.height < 2 || !naturalSize || displayWidth <= 0 || displayHeight <= 0) {
      onMagnifierChange?.(null);
      return;
    }
    onMagnifierChange({
      imageSrc: questionsApi.pageImageUrl(documentId, page),
      box: magnifierRect,
      size: {
        naturalWidth: naturalSize.width,
        naturalHeight: naturalSize.height,
        displayWidth,
        displayHeight,
      },
      label: `${title} crop preview`,
    });
  }, [displayHeight, displayWidth, documentId, magnifierSignature, naturalSize?.height, naturalSize?.width, onMagnifierChange, page, title]);
  useEffect(() => () => { onMagnifierChange?.(null); }, [onMagnifierChange]);

  const setExistingSaving = (id: string, saving: boolean): void => {
    const next = new Set(savingExistingIdsRef.current);
    if (saving) next.add(id);
    else next.delete(id);
    savingExistingIdsRef.current = next;
    setSavingExistingIds(next);
  };
  const updateExisting = (id: string, patch: Partial<Rect>): void => {
    const image = imgRef.current;
    const fallback = existingCrops.find((item) => item.id === id)?.rect;
    const current = editedNaturalsRef.current.get(id) ?? fallback;
    if (!image || !current) return;
    const bounds = image.getBoundingClientRect();
    const scaleX = image.naturalWidth / bounds.width;
    const scaleY = image.naturalHeight / bounds.height;
    const nextRect: Rect = {
      ...current,
      ...(patch.x !== undefined ? { x: patch.x * scaleX } : {}),
      ...(patch.y !== undefined ? { y: patch.y * scaleY } : {}),
      ...(patch.width !== undefined ? { width: patch.width * scaleX } : {}),
      ...(patch.height !== undefined ? { height: patch.height * scaleY } : {}),
    };
    const next = new Map(editedNaturalsRef.current);
    next.set(id, nextRect);
    editedNaturalsRef.current = next;
    setEditedNaturals(next);
  };
  const commitExisting = (id: string): void => {
    const activeRun = existingSaveRuns.current.get(id);
    if (activeRun) {
      // Keep dragging buttery even when an upload is in flight. The local rect has already updated;
      // queue one more serialized save once the current upload settles.
      void activeRun.done.finally(() => { commitExisting(id); });
      return;
    }
    const fallback = existingCrops.find((item) => item.id === id);
    if (!fallback || !cropRef.current?.onExistingCrop) return;
    const run: ExistingSaveRun = { done: Promise.resolve() };
    // Register before the worker begins, so a quick second release can mark this run for a
    // serialized follow-up rather than race the initial upload.
    existingSaveRuns.current.set(id, run);
    run.done = Promise.resolve().then(async (): Promise<void> => {
      setExistingSaving(id, true);
      try {
        const natural = editedNaturalsRef.current.get(id) ?? fallback.rect;
        const replacedUrl = localUrlsRef.current.get(id) ?? fallback.url;
        const nextUrl = await cropRef.current?.onExistingCrop?.(
          id,
          replacedUrl,
          questionsApi.pageImageUrl(documentId, page),
          natural,
          page,
        );
        if (typeof nextUrl === 'string' && nextUrl) {
          const urls = new Map(localUrlsRef.current);
          urls.set(id, nextUrl);
          localUrlsRef.current = urls;
        }
      } finally {
        existingSaveRuns.current.delete(id);
        setExistingSaving(id, false);
      }
    });
  };
  const drawingNewCrop = armed;

  return (
    <div className="verify__source">
      <div className="verify__source-head">
        <span className={`chip ${tone === 'answer' ? 'is-answer' : 'is-solution'}`}>{title}</span>
        <span className="verify__source-name" title={fileName}>{fileName}</span>
        <div className="verify__source-nav">
          <IconButton
            icon={<IconChevronLeft />}
            label="Previous page"
            size="sm"
            disabled={page <= 1}
            onClick={() => { setPage((current) => Math.max(1, current - 1)); }}
          />
          <span className="verify__source-count">{page} / {totalPages}</span>
          <IconButton
            icon={<IconChevronRight />}
            label="Next page"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => { setPage((current) => Math.min(totalPages, current + 1)); }}
          />
        </div>
        {destination ? (
          <div className="inline-flex overflow-hidden rounded-md border border-line bg-white text-xs" role="group" aria-label="Companion figure destination">
            <button
              type="button"
              className={`px-2 py-1 transition-colors ${destination.target === 'answer' ? 'bg-indigo-600 text-white' : 'text-ink-2 hover:bg-surface'}`}
              aria-pressed={destination.target === 'answer'}
              disabled={armed}
              onClick={() => { destination.onTargetChange('answer'); }}
            >
              Answer
            </button>
            <button
              type="button"
              className={`border-l border-line px-2 py-1 transition-colors ${destination.target === 'solution' ? 'bg-indigo-600 text-white' : 'text-ink-2 hover:bg-surface'}`}
              aria-pressed={destination.target === 'solution'}
              disabled={armed}
              onClick={() => { destination.onTargetChange('solution'); }}
            >
              Explanation
            </button>
          </div>
        ) : null}
        {detection ? (
          <IconButton
            icon={detection.busy ? <Spinner /> : <IconSparkle />}
            label={detection.label ?? `Auto-detect ${tone} figures on this page`}
            size="sm"
            disabled={detection.busy || loading || armed}
            onClick={() => { detection.onDetect(page); }}
          />
        ) : null}
        <ZoomControls
          placement="inline"
          zoom={effectiveZoom}
          canZoomIn={!loading && effectiveZoom < maxZoom - 0.001}
          onZoomIn={() => { zoomTo(effectiveZoom * ZOOM_STEP, viewCentre()); }}
          onZoomOut={() => { zoomTo(effectiveZoom / ZOOM_STEP, viewCentre()); }}
          onFit={fitPage}
        />
      </div>
      <div ref={viewportRef} className="verify__source-scroll" style={{ position: 'relative' }}>
        {loading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-ink-3" role="status">
            <Spinner className="text-2xl" />
            <span className="text-sm">Loading page…</span>
          </div>
        ) : null}
        {armed ? (
          <div className="verify__source-crophint" role="status">
            Draw a box on the {tone} — <kbd>Esc</kbd>
          </div>
        ) : null}
        <div ref={scrollRef} className={`crop-canvas__viewport${zoomed ? ' crop-canvas__viewport--zoomed' : ''}`} style={{ inset: 12 }}>
          <div
            className={`verify__source-cropwrap${!armed && !loading ? ' verify__source-cropwrap--zoomable' : ''}`}
            style={displayWidth > 0 && displayHeight > 0 ? { width: displayWidth, height: displayHeight } : undefined}
            onMouseDown={beginLens}
            onDoubleClick={(event) => {
              if (zoomed && !armed && event.target === imgRef.current) fitPage();
            }}
          >
            <img
              ref={imgRef}
              src={questionsApi.pageImageUrl(documentId, page)}
              alt={`${title} page ${String(page)}`}
              className="verify__source-img"
              draggable={false}
              onLoad={(event) => {
                setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                setLoading(false);
              }}
              onError={() => { setLoading(false); }}
            />
            {lens && lens.width >= MIN_DRAW && lens.height >= MIN_DRAW ? (
              <div className="crop-canvas__lens-area" style={{ left: lens.x, top: lens.y, width: lens.width, height: lens.height }} />
            ) : null}
            {drawingNewCrop ? (
              <div className="verify__source-cropoverlay" onMouseDown={beginDraw}>
                {rubber ? (
                  <div
                    className="verify__source-rubber"
                    style={{ left: rubber.x, top: rubber.y, width: rubber.width, height: rubber.height }}
                  />
                ) : null}
              </div>
            ) : null}
            {displayExisting.map(({ item, x, y, width, height }) => (
              <DraggableBox
                key={item.id}
                id={item.id}
                label={item.label}
                x={x}
                y={y}
                width={width}
                height={height}
                variant="saved"
                busy={savingExistingIds.has(item.id)}
                onUpdate={updateExisting}
                // Existing saved figures are removed from their card, not by an
                // accidental right-click over the preview boundary.
                onDelete={() => undefined}
                onGrab={(id) => { setActiveExistingId(id); }}
                onRelease={(id, moved) => {
                  setActiveExistingId(null);
                  if (moved) commitExisting(id);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
