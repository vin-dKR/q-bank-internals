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
 * Build the question and answer PDFs for one chapter: slices tagged `answer` go into the answer
 * PDF, everything else into the question PDF. A side with no slices yields `null` (nothing to upload).
 */
export async function buildChapterPdfs(input: {
  pdfBytes: ArrayBuffer;
  range: PageRange;
  splitPoints: SplitPointsByPage;
  tags: SliceTags;
}): Promise<{ question: Uint8Array | null; answer: Uint8Array | null }> {
  const slices = slicesForRange(input.range, input.splitPoints);
  const toSlice = (s: SliceRef): Slice => ({
    pageNumber: s.pageNumber,
    start: s.start,
    end: s.end,
  });

  const questionSlices = slices.filter((s) => (input.tags[s.id] ?? 'question') === 'question');
  const answerSlices = slices.filter((s) => input.tags[s.id] === 'answer');

  return {
    question: questionSlices.length
      ? await buildPdfFromSlices(input.pdfBytes, questionSlices.map(toSlice))
      : null,
    answer: answerSlices.length
      ? await buildPdfFromSlices(input.pdfBytes, answerSlices.map(toSlice))
      : null,
  };
}
