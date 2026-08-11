import { type DragEvent, type JSX, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// Self-host the pdf.js worker via Vite's `?url` asset import — fingerprinted, served from our own
// origin, and correctly handled in both dev and build (the `new URL(bare-specifier)` form fails to
// load in Vite dev with "Failed to fetch dynamically imported module").
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ErrorBoundary, ErrorFallback, IconButton, IconCheck, IconLayers, IconTrash } from '../../../shared/ui/index.js';
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

/** Fixed page width in the grid so every thumbnail is uniform (zoom only affects the list). */
const GRID_THUMB_WIDTH = 140;

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
  /** Forwarded to the overlay: whether pages carry a question/answer/solution tag chip. */
  taggable?: boolean;
  /** When true, each page gets a select toggle + a drag handle for binding pages to a tree leaf. */
  bindable?: boolean;
  /** List (tall editor) or grid (compact thumbnails). Grid drops the cut overlay — it's an overview. */
  view?: PreviewView;
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
  selectedPages,
  onToggleSelect,
}: PdfPreviewerProps): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const isGrid = view === 'grid';

  // A stable copy so pdf.js never reads a detached buffer across re-renders (only recut on new file).
  const file = useMemo(() => ({ data: new Uint8Array(pdfBytes.slice(0)) }), [pdfBytes]);

  const dragPagesFor = (pageNumber: number, selected: boolean): number[] =>
    selected && selectedPages && selectedPages.size > 0
      ? [...selectedPages].sort((a, b) => a - b)
      : [pageNumber];

  return (
    <div className={`previewer${isGrid ? ' previewer--grid' : ''}`}>
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
                  dragPages={() => dragPagesFor(pageNumber, selected)}
                  onToggleSelect={onToggleSelect}
                  onDeletePage={onDeletePage}
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
  dragPages: () => number[];
  onToggleSelect?: ((pageNumber: number, options?: SelectOptions) => void) | undefined;
  onDeletePage: (pageNumber: number) => void;
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
  dragPages,
  onToggleSelect,
  onDeletePage,
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
      title={bindable ? 'Click to select · Shift-click to select a range · Drag to bind' : undefined}
    >
      <div className="page-thumb__canvas">
        <Page
          pageNumber={pageNumber}
          width={GRID_THUMB_WIDTH}
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
