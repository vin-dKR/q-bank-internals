import { type JSX, useMemo } from 'react';
import type { ChapterKind } from '@ingest/contracts';
import type { SplitPointsByPage } from '../types/split-point.js';
import {
  type PageKinds,
  type PageRange,
  type SliceTags,
  sliceKind,
  slicesForRange,
} from '../lib/build-chapter-pdfs.js';

type SliceTagListProps = {
  range: PageRange;
  splitPoints: SplitPointsByPage;
  tags: SliceTags;
  pageKinds?: PageKinds | undefined;
  hoveredSliceId: string | null;
  onHoverSlice: (sliceId: string | null) => void;
  onTag: (sliceId: string, kind: ChapterKind) => void;
};

/**
 * Lists the cut slices in a chapter's page range with a running question/answer count and per-slice
 * toggles. Hover mirrors the highlight on the page; untagged slices fall back to their source page's
 * default kind (`pageKinds`), then to question.
 */
export function SliceTagList({
  range,
  splitPoints,
  tags,
  pageKinds,
  hoveredSliceId,
  onHoverSlice,
  onTag,
}: SliceTagListProps): JSX.Element {
  const slices = useMemo(() => slicesForRange(range, splitPoints), [range, splitPoints]);

  if (slices.length === 0) {
    return <p className="muted">No slices yet — add horizontal cuts on pages {range.from}–{range.to}.</p>;
  }

  const questionCount = slices.filter((s) => sliceKind(s, tags, pageKinds) === 'question').length;
  const answerCount = slices.filter((s) => sliceKind(s, tags, pageKinds) === 'answer').length;
  const solutionCount = slices.filter((s) => sliceKind(s, tags, pageKinds) === 'solution').length;

  return (
    <div className="stack stack--tight">
      <div className="slice-summary">
        <span className="chip is-question">{questionCount} question</span>
        <span className="chip is-answer">{answerCount} answer</span>
        <span className="chip is-solution">{solutionCount} solution</span>
      </div>
      <ul className="slice-list">
        {slices.map((slice) => {
          const kind: ChapterKind = sliceKind(slice, tags, pageKinds);
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
                <button
                  type="button"
                  className={`btn btn--pill ${kind === 'solution' ? 'is-solution is-active' : ''}`}
                  onClick={() => { onTag(slice.id, 'solution'); }}
                >
                  Solution
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
