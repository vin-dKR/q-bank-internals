import { useEffect, useRef, useState, type JSX } from 'react';
import { Page } from 'react-pdf';
import type { PDFPageProxy } from 'pdfjs-dist';

const PREVIEW_MARGIN = '400px 0px';
const A4_ASPECT_RATIO = 595.28 / 841.89;

/** Offscreen canvases are unmounted to release their pixels and PDF.js page-render resources. */
export function PdfPreviewPage({
  pageNumber,
  width,
  renderTextLayer = false,
}: {
  pageNumber: number;
  width: number;
  renderTextLayer?: boolean;
}): JSX.Element {
  const element = useRef<HTMLDivElement>(null);
  const page = useRef<PDFPageProxy | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [aspectRatio, setAspectRatio] = useState(A4_ASPECT_RATIO);

  useEffect(() => {
    const target = element.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: PREVIEW_MARGIN },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible) page.current?.cleanup();
    return () => {
      page.current?.cleanup();
    };
  }, [visible]);

  return (
    <div ref={element} style={{ width, height: Math.floor(width / aspectRatio) }}>
      {visible ? (
        <Page
          pageNumber={pageNumber}
          width={width}
          renderAnnotationLayer={false}
          renderTextLayer={renderTextLayer}
          onLoadSuccess={(loaded) => {
            page.current = loaded;
            const viewport = loaded.getViewport({ scale: 1 });
            setAspectRatio(viewport.width / viewport.height);
          }}
          loading={
            <div className="flex h-full items-center justify-center text-ink-3">
              Loading page {pageNumber}…
            </div>
          }
        />
      ) : (
        <div
          className="flex h-full items-center justify-center bg-surface-2 text-ink-3"
          aria-label={`Page ${String(pageNumber)} preview not rendered`}
        >
          Page {pageNumber}
        </div>
      )}
    </div>
  );
}
