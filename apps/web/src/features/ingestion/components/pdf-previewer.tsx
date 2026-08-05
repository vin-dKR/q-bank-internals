import { type JSX, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// Self-host the pdf.js worker via Vite's `?url` asset import — fingerprinted, served from our own
// origin, and correctly handled in both dev and build (the `new URL(bare-specifier)` form fails to
// load in Vite dev with "Failed to fetch dynamically imported module").
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
}: PdfPreviewerProps): JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A stable copy so pdf.js never reads a detached buffer across re-renders (only recut on new file).
  const file = useMemo(() => ({ data: new Uint8Array(pdfBytes.slice(0)) }), [pdfBytes]);

  return (
    <div className="previewer">
      <Document
        file={file}
        onLoadSuccess={(doc: { numPages: number }) => {
          setNumPages(doc.numPages);
          onNumPages(doc.numPages);
        }}
        onLoadError={(err: Error) => { setError(err.message); }}
        loading={<p className="muted">Loading PDF…</p>}
        error={<p className="error">Failed to load the PDF{error ? `: ${error}` : ''}</p>}
      >
        {Array.from({ length: numPages }, (_, i) => {
          const pageNumber = i + 1;
          const chapter = chapterForPage(groups, pageNumber);
          return (
            <div key={i} className="page-wrap">
              <div className="page-wrap__num">
                <span className="muted">Page {pageNumber}</span>
                {chapter ? <span className="chip chip--chapter">Chapter {chapter.chapterIndex + 1}</span> : null}
                <button
                  type="button"
                  className="btn btn--ghost btn--xs page-wrap__delete"
                  title="Delete this page (Revert restores it)"
                  disabled={numPages <= 1}
                  onClick={() => { onDeletePage(pageNumber); }}
                >
                  ✕ Delete page
                </button>
              </div>
              <div className="page-wrap__canvas">
                <Page
                  pageNumber={pageNumber}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<div className="page-wrap__placeholder">Loading page {pageNumber}…</div>}
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
    </div>
  );
}
