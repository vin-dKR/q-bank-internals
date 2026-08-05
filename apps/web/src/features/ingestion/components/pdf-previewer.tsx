import { type JSX, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { PdfPageOverlay } from './pdf-page-overlay.js';
import { PdfReflowOverlay } from './pdf-reflow-overlay.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';
import type { ReflowController } from '../hooks/use-reflow-blocks.js';
import type { CutMode, ReadingOrder } from '../types/cut-mode.js';
import { type ChapterGroup, chapterForPage } from '../types/chapter-group.js';

// Self-host the pdf.js worker via Vite (no CDN): fingerprinted and served from our own origin.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type PdfPreviewerProps = {
  pdfBytes: ArrayBuffer | Uint8Array;
  mode: CutMode;
  order: ReadingOrder;
  controller: SplitPointsController;
  reflow: ReflowController;
  groups: ChapterGroup[];
  pageWidth: number;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onToggleTag: (chapterId: string, sliceId: string) => void;
  onNumPages: (numPages: number) => void;
};

/** Renders every page of the PDF with the interactive cut + slice overlay on top. */
export function PdfPreviewer({
  pdfBytes,
  mode,
  order,
  controller,
  reflow,
  groups,
  pageWidth,
  hoveredSliceId,
  onHoverSlice,
  onToggleTag,
  onNumPages,
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
                    hoveredSliceId={hoveredSliceId}
                    onHoverSlice={onHoverSlice}
                    onToggleTag={onToggleTag}
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
