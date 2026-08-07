import type { ChapterKind } from '@ingest/contracts';
import type { SplitPoint, SplitPointsByPage } from '../types/split-point.js';
import { type Slice, buildPdfFromSlices } from './cut-pdf.js';

/** A single cut region of a page, identified so it can be tagged question vs answer. */
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
 * question / answer / explanation source pages, so a slice's *default* kind follows the page it was
 * cut from (answer pages → answer, explanation pages → solution) instead of always `question`. Empty
 * (the single-PDF flow) leaves every default at `question`.
 */
export type PageKinds = Record<number, ChapterKind>;

/** Resolve a slice's kind: an explicit tag wins, else the source page's default, else `question`. */
export function sliceKind(slice: SliceRef, tags: SliceTags, pageKinds?: PageKinds): ChapterKind {
  return tags[slice.id] ?? pageKinds?.[slice.pageNumber] ?? 'question';
}

/** The three built chapter PDFs plus the slice → built-page map of the question part. */
export type ChapterPdfs = {
  question: Uint8Array | null;
  answer: Uint8Array | null;
  solution: Uint8Array | null;
  /**
   * Built-question-PDF page (1-based) per question slice id — the bridge from source pages (where
   * the operator drew topic ranges) to the pages extraction actually sees.
   */
  questionPageBySlice: Record<string, number>;
};

/**
 * Build the question, answer, and solution PDFs for one chapter: slices are routed by their tag
 * (untagged slices fall back to their source page's default kind, then to question). A side with no
 * slices yields `null` (nothing to upload).
 */
export async function buildChapterPdfs(input: {
  pdfBytes: ArrayBuffer | Uint8Array;
  range: PageRange;
  splitPoints: SplitPointsByPage;
  tags: SliceTags;
  pageKinds?: PageKinds;
}): Promise<ChapterPdfs> {
  const slices = slicesForRange(input.range, input.splitPoints);
  const toSlice = (s: SliceRef): Slice => ({
    pageNumber: s.pageNumber,
    start: s.start,
    end: s.end,
  });

  const build = async (
    kind: ChapterKind,
  ): Promise<{ bytes: Uint8Array | null; pageBySlice: Record<string, number> }> => {
    const picked = slices.filter((s) => sliceKind(s, input.tags, input.pageKinds) === kind);
    if (picked.length === 0) return { bytes: null, pageBySlice: {} };
    const built = await buildPdfFromSlices(input.pdfBytes, picked.map(toSlice));
    const pageBySlice: Record<string, number> = {};
    picked.forEach((slice, index) => {
      const page = built.pageNumberOfSlice[index];
      if (page !== null && page !== undefined) pageBySlice[slice.id] = page;
    });
    return { bytes: built.bytes, pageBySlice };
  };

  const question = await build('question');
  const answer = await build('answer');
  const solution = await build('solution');
  return {
    question: question.bytes,
    answer: answer.bytes,
    solution: solution.bytes,
    questionPageBySlice: question.pageBySlice,
  };
}
