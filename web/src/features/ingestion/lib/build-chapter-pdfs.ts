import type { ChapterKind } from '@ingest/contracts';
import type { SplitPoint, SplitPointsByPage } from '../types/split-point.js';

/** A single cut region of a page, identified so it can be tagged as a question or supporting source. */
export type SliceRef = {
  id: string; // `${pageNumber}:${index}`
  pageNumber: number;
  index: number;
  start: number;
  end: number;
};

/** Inclusive 1-based page range that makes up one chapter. */
export type PageRange = {
  from: number;
  to: number;
};

/** Enumerate the horizontal slices of a single page from its split lines. */
export function slicesForPage(pageNumber: number, splits: SplitPoint[]): SliceRef[] {
  const positions = splits
    .filter((s) => s.orientation === 'horizontal')
    .map((s) => s.position)
    .sort((a, b) => a - b);
  const boundaries = [0, ...positions, 1];

  const result: SliceRef[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start === undefined || end === undefined) continue;
    result.push({ id: `${String(pageNumber)}:${String(i)}`, pageNumber, index: i, start, end });
  }
  return result;
}

/** Enumerate every slice across a chapter's page range. */
export function slicesForRange(range: PageRange, splitPoints: SplitPointsByPage): SliceRef[] {
  const result: SliceRef[] = [];
  for (let page = range.from; page <= range.to; page += 1) {
    result.push(...slicesForPage(page, splitPoints[page] ?? []));
  }
  return result;
}

/** Which kind a slice belongs to; slices default to `question` when untagged. */
export type SliceTags = Record<string, ChapterKind>;

/**
 * A page → default kind map. In the separate-files flow the aggregated PDF interleaves each chapter's
 * question / answer / explanation / grouped-companion source pages, so a slice's *default* kind follows
 * the page it was cut from instead of always `question`. Empty (the single-PDF flow) leaves every
 * default at `question`.
 */
export type PageKinds = Record<number, ChapterKind>;

/** Resolve a slice's kind: an explicit tag wins, else the source page's default, else `question`. */
export function sliceKind(slice: SliceRef, tags: SliceTags, pageKinds?: PageKinds): ChapterKind {
  return tags[slice.id] ?? pageKinds?.[slice.pageNumber] ?? 'question';
}
