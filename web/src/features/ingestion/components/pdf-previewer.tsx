import {
  type CSSProperties,
  type DragEvent,
  type JSX,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// Self-host the pdf.js worker via Vite's `?url` asset import — fingerprinted, served from our own
// origin, and correctly handled in both dev and build (the `new URL(bare-specifier)` form fails to
// load in Vite dev with "Failed to fetch dynamically imported module").
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ErrorBoundary,
  ErrorFallback,
  IconButton,
  IconCheck,
  IconLayers,
  IconTrash,
  IconX,
} from '../../../shared/ui/index.js';
import { setDraggedPages } from '../lib/page-dnd.js';
import { PdfPageOverlay } from './pdf-page-overlay.js';
import { PdfReflowOverlay } from './pdf-reflow-overlay.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import type { CutMode, ReadingOrder } from '../types/cut-mode.js';
import { type ChapterGroup, chapterForPage } from '../types/chapter-group.js';
import type { PageKinds } from '../lib/build-chapter-pdfs.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** How the pages are laid out: the tall single-column editor, or a compact thumbnail grid. */
export type PreviewView = 'list' | 'grid';

/** Fallback page width in the grid before the container is measured (then thumbnails fill their column). */
const GRID_THUMB_WIDTH = 140;

/** Grid density bounds — how many thumbnails per row the operator can dial in (fewer = larger pages). */
export const MIN_GRID_COLUMNS = 1;
export const MAX_GRID_COLUMNS = 5;
export const DEFAULT_GRID_COLUMNS = 5;

/** Column gap (matches `.previewer__grid`) and per-thumb chrome, used to size a thumbnail to its column. */
const GRID_GAP = 12;
const THUMB_CHROME = 10;

type SelectOptions = { range?: boolean };

type PdfPreviewerProps = {
  pdfBytes: ArrayBuffer | Uint8Array;
  mode: CutMode;
  order: ReadingOrder;
  controller: SplitPointsController;
  reflow: ReflowController;
  groups: ChapterGroup[];
  pageKinds?: PageKinds | undefined;
  pageWidth: number;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onToggleTag: (chapterId: string, sliceId: string) => void;
  onNumPages: (numPages: number) => void;
  onDeletePage: (pageNumber: number) => void;
  /** Forwarded to the overlay: whether pages carry a question/supporting-source tag chip. */
  taggable?: boolean;
  /** When true, each page gets a select toggle + a drag handle for binding pages to a tree leaf. */
  bindable?: boolean;
  /** List (tall editor) or grid (compact thumbnails). Grid drops the cut overlay — it's an overview. */
  view?: PreviewView;
  /** Grid density — thumbnails per row (fewer columns render larger pages to reduce eye strain). */
  gridColumns?: number;
  /** Pages currently selected for dragging (a drag carries the whole selection, or just its page). */
  selectedPages?: ReadonlySet<number>;
  onToggleSelect?: (pageNumber: number, options?: SelectOptions) => void;
};

/** Renders every page of the PDF, either as the tall cut editor or a compact draggable grid. */
export function PdfPreviewer({
  pdfBytes,
  mode,
  order,
  controller,
  reflow,
  groups,
  pageKinds,
  pageWidth,
  hoveredSliceId,
  onHoverSlice,
  onToggleTag,
  onNumPages,
  onDeletePage,
  taggable = true,
  bindable = false,
  view = 'list',
  gridColumns = DEFAULT_GRID_COLUMNS,
  selectedPages,
  onToggleSelect,
}: PdfPreviewerProps): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const isGrid = view === 'grid';

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const [fullscreenPage, setFullscreenPage] = useState<number | null>(null);

  // Measure the grid so a thumbnail can fill exactly one column — the resize also tracks the panel
  // drag (the left pane changing width), keeping page images crisp at any density.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isGrid) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setGridWidth(width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [isGrid]);

  // Fewer columns → each column is wider → the page renders larger, so density doubles as zoom.
  const thumbWidth =
    isGrid && gridWidth > 0
      ? Math.max(
          80,
          Math.floor((gridWidth - (gridColumns - 1) * GRID_GAP) / gridColumns) - THUMB_CHROME,
        )
      : GRID_THUMB_WIDTH;

  // A stable copy so pdf.js never reads a detached buffer across re-renders (only recut on new file).
  const file = useMemo(() => ({ data: new Uint8Array(pdfBytes.slice(0)) }), [pdfBytes]);

  const dragPagesFor = (pageNumber: number, selected: boolean): number[] =>
    selected && selectedPages && selectedPages.size > 0
      ? [...selectedPages].sort((a, b) => a - b)
      : [pageNumber];

  return (
    <div
      ref={containerRef}
      className={`previewer${isGrid ? ' previewer--grid' : ''}`}
      style={isGrid ? ({ '--grid-cols': gridColumns } as CSSProperties) : undefined}
    >
      {/*
        react-pdf tears the PDF worker transport down when this subtree unmounts (e.g. a route change
        or the browser Back button). A `Page` whose `loadPage` effect fires during that teardown calls
        `getPage` on the now-destroyed transport, which throws synchronously and — with no boundary —
        crashes the whole SPA. Contain it here: keyed on `file`, the boundary self-heals on the next
        document and the operator sees a recoverable panel instead of a white screen.
      */}
      <ErrorBoundary
        resetKeys={[file]}
        fallback={(_error, reset) => (
          <ErrorFallback
            title="Couldn’t render the PDF preview"
            body="The preview hit an error while loading. Reload it — your pages and tree are untouched."
            retryLabel="Reload preview"
            onRetry={reset}
          />
        )}
      >
        <Document
          file={file}
          className={isGrid ? 'previewer__grid' : undefined}
          onLoadSuccess={(doc: { numPages: number }) => {
            setNumPages(doc.numPages);
            onNumPages(doc.numPages);
          }}
          onLoadError={(err: Error) => {
            setError(err.message);
          }}
          loading={<p className="muted">Loading PDF…</p>}
          error={<p className="error">Failed to load the PDF{error ? `: ${error}` : ''}</p>}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNumber = i + 1;
            const selected = selectedPages?.has(pageNumber) ?? false;

            if (isGrid) {
              return (
                <PageThumb
                  key={i}
                  pageNumber={pageNumber}
                  selected={selected}
                  bindable={bindable}
                  canDelete={numPages > 1}
                  thumbWidth={thumbWidth}
                  dragPages={() => dragPagesFor(pageNumber, selected)}
                  onToggleSelect={onToggleSelect}
                  onDeletePage={onDeletePage}
                  onOpen={setFullscreenPage}
                />
              );
            }

            const chapter = chapterForPage(groups, pageNumber);
            return (
              <div key={i} id={`cut-page-${String(pageNumber)}`} className="page-wrap">
                <div className="page-wrap__num">
                  {bindable ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={selected}
                        onChange={(event) => {
                          onToggleSelect?.(pageNumber, {
                            range: (event.nativeEvent as MouseEvent).shiftKey,
                          });
                        }}
                      />
                      Page {pageNumber}
                    </label>
                  ) : (
                    <span className="muted">Page {pageNumber}</span>
                  )}
                  {chapter ? (
                    <span className="chip chip--chapter">Chapter {chapter.chapterIndex + 1}</span>
                  ) : null}
                  {bindable ? (
                    <span
                      draggable
                      data-page={pageNumber}
                      onDragStart={(event) => {
                        setDraggedPages(event, dragPagesFor(pageNumber, selected));
                      }}
                      className="ml-auto inline-flex cursor-grab items-center gap-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] font-medium text-ink-2 active:cursor-grabbing hover:bg-surface-2 [&>svg]:size-3.5"
                      title="Drag onto a leaf's Question / Answer / Solution slot"
                    >
                      <IconLayers /> Drag
                      {selected && selectedPages && selectedPages.size > 1
                        ? ` ${String(selectedPages.size)}`
                        : ''}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs page-wrap__delete"
                    title="Delete this page (Revert restores it)"
                    disabled={numPages <= 1}
                    onClick={() => {
                      onDeletePage(pageNumber);
                    }}
                  >
                    <IconTrash /> Delete page
                  </button>
                </div>
                <div
                  className={`page-wrap__canvas ${selected ? 'ring-2 ring-brand rounded-lg' : ''}`}
                >
                  <Page
                    pageNumber={pageNumber}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={mode === 'none'}
                    loading={
                      <div className="page-wrap__placeholder">Loading page {pageNumber}…</div>
                    }
                  />
                  {/* None is a passive read mode: render the selectable text layer and no overlay so
                      the operator can select and copy text from the page. */}
                  {mode === 'none' ? null : mode === 'reflow' ? (
                    <PdfReflowOverlay pageNumber={pageNumber} controller={reflow} />
                  ) : (
                    <PdfPageOverlay
                      pageNumber={pageNumber}
                      mode={mode}
                      order={order}
                      controller={controller}
                      chapter={chapter}
                      pageKinds={pageKinds}
                      hoveredSliceId={hoveredSliceId}
                      onHoverSlice={onHoverSlice}
                      onToggleTag={onToggleTag}
                      taggable={taggable}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {fullscreenPage !== null ? (
            <PageFullscreen
              pageNumber={fullscreenPage}
              onClose={() => {
                setFullscreenPage(null);
              }}
            />
          ) : null}
        </Document>
      </ErrorBoundary>
    </div>
  );
}

type PageThumbProps = {
  pageNumber: number;
  selected: boolean;
  bindable: boolean;
  canDelete: boolean;
  thumbWidth: number;
  dragPages: () => number[];
  onToggleSelect?: ((pageNumber: number, options?: SelectOptions) => void) | undefined;
  onDeletePage: (pageNumber: number) => void;
  onOpen: (pageNumber: number) => void;
};

/**
 * One compact page in the grid overview: click to (de)select, shift-click to extend a range, drag to
 * bind onto a leaf. Dragging a selected page carries the whole selection, so an operator sweeps a
 * batch of pages and drops them in one gesture. No cut overlay — the grid is for picking, not cutting.
 */
function PageThumb({
  pageNumber,
  selected,
  bindable,
  canDelete,
  thumbWidth,
  dragPages,
  onToggleSelect,
  onDeletePage,
  onOpen,
}: PageThumbProps): JSX.Element {
  const select = (event: { shiftKey: boolean }): void => {
    onToggleSelect?.(pageNumber, { range: event.shiftKey });
  };

  return (
    <div
      id={`cut-page-${String(pageNumber)}`}
      className={`page-thumb${selected ? ' is-selected' : ''}`}
      draggable={bindable}
      onDragStart={(event: DragEvent) => {
        setDraggedPages(event, dragPages());
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpen(pageNumber);
      }}
      onClick={bindable ? select : undefined}
      onKeyDown={
        bindable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select(event);
              }
            }
          : undefined
      }
      role={bindable ? 'button' : undefined}
      tabIndex={bindable ? 0 : undefined}
      aria-pressed={bindable ? selected : undefined}
      title={
        bindable
          ? 'Click to select · Shift-click to select a range · Drag to bind · Right-click to preview'
          : 'Right-click to preview full-screen'
      }
    >
      <div className="page-thumb__canvas">
        <Page
          pageNumber={pageNumber}
          width={thumbWidth}
          renderAnnotationLayer={false}
          renderTextLayer={false}
          loading={<div className="page-thumb__placeholder">…</div>}
        />
        {selected ? (
          <span className="page-thumb__check" aria-hidden>
            <IconCheck />
          </span>
        ) : null}
      </div>
      <div className="page-thumb__bar">
        <span className="page-thumb__num">Pg {pageNumber}</span>
        <IconButton
          icon={<IconTrash />}
          label={`Delete page ${String(pageNumber)}`}
          size="sm"
          disabled={!canDelete}
          onClick={(event) => {
            event.stopPropagation();
            onDeletePage(pageNumber);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Right-clicking a thumbnail opens the page here at full size so the operator can read fine print
 * without leaving the grid. Rendered inside the `Document` so the `Page` shares its worker transport;
 * Escape or a click on the backdrop dismisses it (the shared modal pattern from `useConfirm`).
 */
function PageFullscreen({
  pageNumber,
  onClose,
}: {
  pageNumber: number;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const width = Math.min(900, Math.round(window.innerWidth * 0.9));
  return (
    <div className="modal" onMouseDown={onClose}>
      <div
        className="modal__panel modal__panel--page"
        role="dialog"
        aria-modal="true"
        aria-label={`Page ${String(pageNumber)}`}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="modal__head">
          <h2>Page {pageNumber}</h2>
          <IconButton icon={<IconX />} label="Close preview" onClick={onClose} />
        </div>
        <div className="page-fullscreen">
          <Page
            pageNumber={pageNumber}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<div className="page-thumb__placeholder">Loading page {pageNumber}…</div>}
          />
        </div>
      </div>
    </div>
  );
}
