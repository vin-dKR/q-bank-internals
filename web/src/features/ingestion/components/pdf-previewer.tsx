import { type JSX, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// Self-host the pdf.js worker via Vite's `?url` asset import — fingerprinted, served from our own
// origin, and correctly handled in both dev and build (the `new URL(bare-specifier)` form fails to
// load in Vite dev with "Failed to fetch dynamically imported module").
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ErrorBoundary, ErrorFallback, IconLayers, IconTrash } from '../../../shared/ui/index.js';
import { setDraggedPages } from '../lib/page-dnd.js';
import { PdfPageOverlay } from './pdf-page-overlay.js';
import { PdfReflowOverlay } from './pdf-reflow-overlay.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import type { CutMode, ReadingOrder } from '../types/cut-mode.js';
import { type ChapterGroup, chapterForPage } from '../types/chapter-group.js';
import type { PageKinds } from '../lib/build-chapter-pdfs.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  /** Pages currently selected for dragging (a drag carries the whole selection, or just its page). */
  selectedPages?: ReadonlySet<number>;
  onToggleSelect?: (pageNumber: number) => void;
};

/** Renders every page of the PDF with the interactive cut + slice overlay on top. */
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
  selectedPages,
  onToggleSelect,
}: PdfPreviewerProps): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A stable copy so pdf.js never reads a detached buffer across re-renders (only recut on new file).
  const file = useMemo(() => ({ data: new Uint8Array(pdfBytes.slice(0)) }), [pdfBytes]);

  return (
    <div className="previewer">
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
            const chapter = chapterForPage(groups, pageNumber);
            const selected = selectedPages?.has(pageNumber) ?? false;
            const dragPages = (): number[] =>
              selected && selectedPages && selectedPages.size > 0
                ? [...selectedPages].sort((a, b) => a - b)
                : [pageNumber];
            return (
              <div key={i} className="page-wrap">
                <div className="page-wrap__num">
                  {bindable ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={selected}
                        onChange={() => {
                          onToggleSelect?.(pageNumber);
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
                        setDraggedPages(event, dragPages());
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
                    renderTextLayer={false}
                    loading={
                      <div className="page-wrap__placeholder">Loading page {pageNumber}…</div>
                    }
                  />
                  {mode === 'reflow' ? (
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
