import { type JSX, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react';
import { IconButton, IconChevronLeft, IconChevronRight, Spinner } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';
import { usePageCount } from '../hooks/use-questions.js';

type Rect = { x: number; y: number; width: number; height: number };

/** Optional crop capability: when `armed`, a rubber-band draw on the previewed page reports its crop. */
type CropCapability = {
  armed: boolean;
  /** A box was drawn: `natural` is its rect in the page image's natural pixels. */
  onCrop: (imageUrl: string, natural: Rect) => void;
  /** The operator dismissed the armed crop (Esc). */
  onCancel: () => void;
};

/** Smaller than this (display px) is a stray click, not a drawn region. */
const MIN_DRAW = 8;

/**
 * A read-only preview of one sibling source PDF — the unit's answer or solution — shown beside the
 * question page in Verify. Owns its own page cursor: seeded to `defaultPage` (this topic's
 * answer/solution start) and re-seeded whenever that changes as the operator moves through the
 * question PDF, with prev/next nav so the answer/explanation can be checked against the question.
 *
 * With `crop.armed` set (the solution pane, while an explanation-image crop is armed) a rubber-band
 * overlay captures a drag on the page and reports the drawn region — the crop's entry point.
 */
export function SourcePreviewPane({
  title,
  tone,
  documentId,
  fileName,
  defaultPage,
  crop,
}: {
  title: string;
  tone: 'answer' | 'solution';
  documentId: string;
  fileName: string;
  defaultPage: number;
  crop?: CropCapability;
}): JSX.Element {
  const [page, setPage] = useState(defaultPage);
  useEffect(() => { setPage(defaultPage); }, [defaultPage]);
  const pageCount = usePageCount(documentId);
  const totalPages = pageCount.data ?? 1;
  // Loader for the previewed page image (fetched from Drive via the API proxy). The <img> is reused
  // across page changes, so reset on every page change — `onLoad` fires only for the new load.
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); }, [page, documentId]);

  // --- Rubber-band crop (only while `crop.armed`) ---
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [rubber, setRubber] = useState<Rect | null>(null);
  const armed = crop?.armed ?? false;
  // Read the latest crop callbacks through a ref so the drag listeners never capture a stale closure
  // (the parent passes a fresh `crop` object each render).
  const cropRef = useRef(crop);
  cropRef.current = crop;

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
    startRef.current = imgPoint(event.clientX, event.clientY);
    setRubber({ ...startRef.current, width: 0, height: 0 });
  };

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
      });
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
      </div>
      <div className="verify__source-scroll" style={{ position: 'relative' }}>
        {loading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-ink-3" role="status">
            <Spinner className="text-2xl" />
            <span className="text-sm">Loading page…</span>
          </div>
        ) : null}
        {armed ? (
          <div className="verify__source-crophint" role="status">
            Draw a box on the solution — <kbd>Esc</kbd>
          </div>
        ) : null}
        <div className="verify__source-cropwrap">
          <img
            ref={imgRef}
            src={questionsApi.pageImageUrl(documentId, page)}
            alt={`${title} page ${String(page)}`}
            className="verify__source-img"
            onLoad={() => { setLoading(false); }}
            onError={() => { setLoading(false); }}
          />
          {armed ? (
            <div className="verify__source-cropoverlay" onMouseDown={beginDraw}>
              {rubber ? (
                <div
                  className="verify__source-rubber"
                  style={{ left: rubber.x, top: rubber.y, width: rubber.width, height: rubber.height }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
