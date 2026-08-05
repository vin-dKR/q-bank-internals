import { type CSSProperties, type JSX, type MouseEvent, useEffect, useRef, useState } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import type { SplitPoint } from '../types/split-point.js';
import type { PageChapterInfo } from '../types/chapter-group.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';
import { type CutMode, type ReadingOrder, orientationForMode } from '../types/cut-mode.js';
import { cellsForPage } from '../lib/apply-grid-split.js';

type PdfPageOverlayProps = {
  pageNumber: number;
  mode: CutMode;
  order: ReadingOrder;
  controller: SplitPointsController;
  chapter: PageChapterInfo;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onToggleTag: (chapterId: string, sliceId: string) => void;
};

const KIND_LABEL: Record<ChapterKind, string> = {
  question: 'Question',
  answer: 'Answer',
  solution: 'Solution',
};

/** Tag id of a page with no interior cuts — matches the single slice `slicesForPage` emits. */
const wholePageSliceId = (pageNumber: number): string => `${String(pageNumber)}:0`;

/**
 * Interactive layer over a rendered page. A plain click draws a cut line in the active mode's
 * orientation (right-click draws the opposite axis as a quick guide); every cut line is
 * draggable/removable. The cells the current lines will produce are shaded and numbered in
 * column-major reading order so the operator sees the result before applying. Once cuts are
 * materialised into their own pages, a page has one whole-page cell that carries the question /
 * answer tag chip.
 */
export function PdfPageOverlay({
  pageNumber,
  mode,
  order,
  controller,
  chapter,
  hoveredSliceId,
  onHoverSlice,
  onToggleTag,
}: PdfPageOverlayProps): JSX.Element {
  const { splitPoints, addSplit, beginMove, moveSplit, removeSplit } = controller;
  const pageSplits = splitPoints[pageNumber] ?? [];
  const cells = cellsForPage(pageNumber, pageSplits, order);
  const isWholePage = cells.length === 1;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; orientation: SplitPoint['orientation'] } | null>(
    null,
  );

  const handleAddSplit = (event: MouseEvent<HTMLDivElement>): void => {
    if (!containerRef.current || event.target !== containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const active = orientationForMode(mode);
    const opposite = active === 'horizontal' ? 'vertical' : 'horizontal';
    // Right-click drops a guide on the other axis without leaving the current mode.
    const orientation = event.button === 2 ? opposite : active;
    addSplit(pageNumber, orientation === 'horizontal' ? y : x, orientation);
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: globalThis.MouseEvent): void => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const raw =
        dragging.orientation === 'horizontal'
          ? (event.clientY - rect.top) / rect.height
          : (event.clientX - rect.left) / rect.width;
      moveSplit(dragging.id, Math.max(0, Math.min(1, raw)));
    };
    const handleUp = (): void => { setDragging(null); };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, moveSplit]);

  return (
    <div
      ref={containerRef}
      className="page-overlay"
      onClick={handleAddSplit}
      onContextMenu={(event) => { event.preventDefault(); }}
    >
      {/* Cell grid: whole-page cells carry the tag chip; multi-cut cells just preview the split. */}
      {cells.map((cell, index) => {
        const bandStyle: CSSProperties = {
          top: `${String(cell.start * 100)}%`,
          height: `${String((cell.end - cell.start) * 100)}%`,
          left: `${String((cell.x0 ?? 0) * 100)}%`,
          width: `${String(((cell.x1 ?? 1) - (cell.x0 ?? 0)) * 100)}%`,
        };
        if (isWholePage) {
          const sliceId = wholePageSliceId(pageNumber);
          const kind: ChapterKind | null = chapter ? chapter.tags[sliceId] ?? 'question' : null;
          const kindClass = kind === null ? 'is-loose' : `is-${kind}`;
          const isHovered = hoveredSliceId === sliceId;
          return (
            <div key={sliceId} className={`slice-band ${kindClass} ${isHovered ? 'is-hovered' : ''}`} style={bandStyle}>
              <span className="slice-band__label">
                {chapter ? `C${String(chapter.chapterIndex + 1)} · ` : ''}
                page {pageNumber}
                {kind ? ` · ${KIND_LABEL[kind]}` : ''}
              </span>
              <button
                type="button"
                className={`slice-band__chip ${kind ? `is-${kind}` : ''}`}
                disabled={!chapter}
                title={chapter ? 'Toggle question / answer' : 'Add this page to a chapter to tag it'}
                onMouseEnter={() => { onHoverSlice(sliceId); }}
                onMouseLeave={() => { onHoverSlice(null); }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (chapter) onToggleTag(chapter.chapterId, sliceId);
                }}
              >
                {kind ? KIND_LABEL[kind] : 'no chapter'}
              </button>
            </div>
          );
        }
        return (
          <div key={`cell-${String(index)}`} className="cut-cell" style={bandStyle}>
            <span className="cut-cell__order">{index + 1}</span>
          </div>
        );
      })}

      {/* Cut lines + guides. */}
      {pageSplits.map((split) => (
        <div
          key={split.id}
          className={`split-line split-line--${split.orientation}`}
          style={
            split.orientation === 'horizontal'
              ? { top: `${String(split.position * 100)}%` }
              : { left: `${String(split.position * 100)}%` }
          }
          onMouseDown={(event) => {
            event.stopPropagation();
            beginMove();
            setDragging({ id: split.id, orientation: split.orientation });
          }}
        >
          <span
            className="split-line__remove"
            onClick={(event) => {
              event.stopPropagation();
              removeSplit(split.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
