import { PDFDocument } from 'pdf-lib';
import type { ReadingOrder } from '../types/cut-mode.js';
import type { SplitPoint, SplitPointsByPage } from '../types/split-point.js';
import { type PdfInput, type Slice, cellBounds, drawCellOnA4 } from './cut-pdf.js';

/** Interior cut fractions of one axis, wrapped in the page edges, sorted, de-duplicated to bounds. */
function boundaries(positions: number[]): number[] {
  const interior = positions.filter((p) => p > 0 && p < 1).sort((a, b) => a - b);
  return [0, ...interior, 1];
}

/**
 * The cells one page is cut into, in the given reading order. `column` (default) reads each column
 * top→bottom, left column first — keeping two-column question papers (NEET / DPP) in question order
 * once the columns become separate pages; `row` reads left→right across each band. A page with no
 * interior cuts yields a single full-page cell.
 */
export function cellsForPage(
  pageNumber: number,
  splits: SplitPoint[],
  order: ReadingOrder = 'column',
): Slice[] {
  const cols = boundaries(splits.filter((s) => s.orientation === 'vertical').map((s) => s.position));
  const rows = boundaries(splits.filter((s) => s.orientation === 'horizontal').map((s) => s.position));

  const cell = (c: number, r: number): Slice | null => {
    const x0 = cols[c];
    const x1 = cols[c + 1];
    const start = rows[r];
    const end = rows[r + 1];
    if (x0 === undefined || x1 === undefined || start === undefined || end === undefined) return null;
    return { pageNumber, x0, x1, start, end };
  };

  const cells: Slice[] = [];
  if (order === 'row') {
    for (let r = 0; r < rows.length - 1; r += 1) {
      for (let c = 0; c < cols.length - 1; c += 1) {
        const s = cell(c, r);
        if (s) cells.push(s);
      }
    }
  } else {
    for (let c = 0; c < cols.length - 1; c += 1) {
      for (let r = 0; r < rows.length - 1; r += 1) {
        const s = cell(c, r);
        if (s) cells.push(s);
      }
    }
  }
  return cells;
}

/** Whether a page carries at least one interior (non-edge) cut line. */
function hasCuts(splits: SplitPoint[]): boolean {
  return splits.some((s) => s.position > 0 && s.position < 1);
}

/**
 * Materialise the current split lines into a new PDF: every cut page is split into its grid of
 * cells (each a fresh A4 page, vector-preserved), and every uncut page passes through unchanged so
 * nothing is needlessly reflowed. This is the "refresh into a new working PDF" step that lets the
 * cut modes chain (vertical → horizontal → …).
 */
export async function applyGridSplit(
  pdfBytes: PdfInput,
  splitPoints: SplitPointsByPage,
  order: ReadingOrder = 'column',
): Promise<Uint8Array> {
  const origPdf = await PDFDocument.load(pdfBytes.slice(0));
  const out = await PDFDocument.create();
  // One copier shares fonts/images across pages and cells. Per-page copies duplicate those resources.
  const pages = await out.copyPages(origPdf, origPdf.getPageIndices());

  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1;
    const splits = splitPoints[pageNumber] ?? [];
    if (!hasCuts(splits)) {
      out.addPage(page);
      continue;
    }
    for (const cell of cellsForPage(pageNumber, splits, order)) {
      const bounds = cellBounds(page.getSize(), cell);
      if (bounds) drawCellOnA4(out, await out.embedPage(page, bounds), 0);
    }
  }

  return out.save();
}
