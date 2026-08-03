import { type JSX, useMemo } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import type { SplitPointsByPage } from '../types/split-point.js';
import { type PageRange, type SliceTags, slicesForRange } from '../lib/build-chapter-pdfs.js';

type SliceTagListProps = {
  range: PageRange;
  splitPoints: SplitPointsByPage;
  tags: SliceTags;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onTag: (sliceId: string, kind: ChapterKind) => void;
};

/**
 * Lists the cut slices in a chapter's page range with a running question/answer count and per-slice
 * toggles. Hover mirrors the highlight on the page; untagged slices default to question.
 */
export function SliceTagList({
  range,
  splitPoints,
  tags,
  hoveredSliceId,
  onHoverSlice,
  onTag,
}: SliceTagListProps): JSX.Element {
  const slices = useMemo(() => slicesForRange(range, splitPoints), [range, splitPoints]);

  if (slices.length === 0) {
    return <p className="muted">No slices yet — add horizontal cuts on pages {range.from}–{range.to}.</p>;
  }

  const questionCount = slices.filter((s) => (tags[s.id] ?? 'question') === 'question').length;
  const answerCount = slices.length - questionCount;

  return (
    <div className="stack stack--tight">
      <div className="slice-summary">
        <span className="chip is-question">{questionCount} question</span>
        <span className="chip is-answer">{answerCount} answer</span>
      </div>
      <ul className="slice-list">
        {slices.map((slice) => {
          const kind: ChapterKind = tags[slice.id] ?? 'question';
          const isHovered = hoveredSliceId === slice.id;
          return (
            <li
              key={slice.id}
              className={`slice-list__item ${isHovered ? 'is-hovered' : ''}`}
              onMouseEnter={() => { onHoverSlice(slice.id); }}
              onMouseLeave={() => { onHoverSlice(null); }}
            >
              <span className="muted">
                p{slice.pageNumber} · slice {slice.index + 1}
              </span>
              <div className="folder-select__row">
                <button
                  type="button"
                  className={`btn btn--pill ${kind === 'question' ? 'is-question is-active' : ''}`}
                  onClick={() => { onTag(slice.id, 'question'); }}
                >
                  Question
                </button>
                <button
                  type="button"
                  className={`btn btn--pill ${kind === 'answer' ? 'is-answer is-active' : ''}`}
                  onClick={() => { onTag(slice.id, 'answer'); }}
                >
                  Answer
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
