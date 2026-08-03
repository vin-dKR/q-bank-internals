import { type CSSProperties, type JSX, type MouseEvent, useEffect, useRef, useState } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import type { SplitPoint } from '../types/split-point.js';
import type { PageChapterInfo } from '../types/chapter-group.js';
import type { SplitPointsController } from '../hooks/use-split-points.js';
import { slicesForPage } from '../lib/build-chapter-pdfs.js';

type PdfPageOverlayProps = {
  pageNumber: number;
  controller: SplitPointsController;
  chapter: PageChapterInfo;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onToggleTag: (chapterId: string, sliceId: string) => void;
};

const KIND_LABEL: Record<ChapterKind, string> = { question: 'Question', answer: 'Answer' };

/**
 * Interactive layer over a rendered page. Shows every cut slice as a colour-coded band you can tag
 * question/answer in place; left-click empty space adds a horizontal cut, right-click a vertical
 * guide, and both are draggable/removable.
 */
export function PdfPageOverlay({
  pageNumber,
  controller,
  chapter,
  hoveredSliceId,
  onHoverSlice,
  onToggleTag,
}: PdfPageOverlayProps): JSX.Element {
  const { splitPoints, addSplit, beginMove, moveSplit, removeSplit } = controller;
  const pageSplits = splitPoints[pageNumber] ?? [];
  const slices = slicesForPage(pageNumber, pageSplits);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; orientation: SplitPoint['orientation'] } | null>(
    null,
  );

  const handleAddSplit = (event: MouseEvent<HTMLDivElement>): void => {
    if (!containerRef.current || event.target !== containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (event.button === 2) {
      addSplit(pageNumber, x, 'vertical');
    } else {
      addSplit(pageNumber, y, 'horizontal');
    }
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
      {/* Colour-coded slice bands (do not capture the add-cut click). */}
      {slices.map((slice) => {
        const kind: ChapterKind | null = chapter ? chapter.tags[slice.id] ?? 'question' : null;
        const kindClass = kind === null ? 'is-loose' : `is-${kind}`;
        const isHovered = hoveredSliceId === slice.id;
        const bandStyle: CSSProperties = {
          top: `${String(slice.start * 100)}%`,
          height: `${String((slice.end - slice.start) * 100)}%`,
        };
        return (
          <div key={slice.id} className={`slice-band ${kindClass} ${isHovered ? 'is-hovered' : ''}`} style={bandStyle}>
            <span className="slice-band__label">
              {chapter ? `C${String(chapter.chapterIndex + 1)} · ` : ''}
              slice {slice.index + 1}
              {kind ? ` · ${KIND_LABEL[kind]}` : ''}
            </span>
            <button
              type="button"
              className={`slice-band__chip ${kind ? `is-${kind}` : ''}`}
              disabled={!chapter}
              title={chapter ? 'Toggle question / answer' : 'Add this page to a chapter to tag it'}
              onMouseEnter={() => { onHoverSlice(slice.id); }}
              onMouseLeave={() => { onHoverSlice(null); }}
              onClick={(event) => {
                event.stopPropagation();
                if (chapter) onToggleTag(chapter.chapterId, slice.id);
              }}
            >
              {kind ? KIND_LABEL[kind] : 'no chapter'}
            </button>
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
