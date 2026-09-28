import {
  type PDFDocument as PDFDocumentType,
  type PDFEmbeddedPage,
  type PDFPage,
  PageSizes,
} from 'pdf-lib';

/**
 * A rectangular cell of a source page, as 0–1 fractions. `start`/`end` are measured from the top of
 * the page; `x0`/`x1` from the left and default to the full page width (so an ordinary horizontal
 * band is `{ start, end }` with x left implicit).
 */
export type Slice = {
  pageNumber: number; // 1-based
  start: number; // top edge (0 = page top)
  end: number; // bottom edge (1 = page bottom)
  x0?: number; // left edge (0 = page left), default 0
  x1?: number; // right edge (1 = page right), default 1
};

/** PDF bytes accepted by the builders — the browser hands us either shape. */
export type PdfInput = ArrayBuffer | Uint8Array;

const EPSILON = 1e-4; // fractions closer than this bound a zero-area cell — nothing to draw

/**
 * Embed several cells from the same source document in one operation. `pdf-lib` keeps one object
 * copier for an `embedPages` call, so a page's fonts and high-resolution image XObjects are copied
 * once and referenced by every cut cell. Calling `embedPage` once per cell created a fresh copier
 * each time, which could multiply a small scanned PDF into many megabytes after a grid cut.
 *
 * This is deliberately a resource-sharing optimisation, not image compression: every cell still
 * draws the original page's vector content and original image streams at their native quality.
 */
export async function embedCells(
  target: PDFDocumentType,
  source: PDFDocumentType,
  slices: readonly Slice[],
): Promise<Array<PDFEmbeddedPage | null>> {
  const result: Array<PDFEmbeddedPage | null> = Array.from({ length: slices.length }, () => null);
  const pages: PDFPage[] = [];
  const boxes: Array<{ left: number; bottom: number; right: number; top: number }> = [];
  const indexes: number[] = [];

  for (const [index, slice] of slices.entries()) {
    const page = source.getPage(slice.pageNumber - 1);
    const { width, height } = page.getSize();
    const left = width * (slice.x0 ?? 0);
    const right = width * (slice.x1 ?? 1);
    // PDF coordinates put the origin bottom-left, so a fraction from the top flips into height − f·height.
    const bottom = height * (1 - slice.end);
    const top = height * (1 - slice.start);
    if (right - left <= EPSILON || top - bottom <= EPSILON) continue;
    pages.push(page);
    boxes.push({ left, bottom, right, top });
    indexes.push(index);
  }

  if (pages.length === 0) return result;
  const embedded = await target.embedPages(pages, boxes);
  for (const [embeddedIndex, cell] of embedded.entries()) {
    const resultIndex = indexes[embeddedIndex];
    if (resultIndex !== undefined) result[resultIndex] = cell;
  }
  return result;
}

/** Add one A4 page and draw the embedded cell scaled to fit under an optional top margin. */
export function drawCellOnA4(
  target: PDFDocumentType,
  cell: PDFEmbeddedPage,
  topMargin: number,
): void {
  const [a4Width, a4Height] = PageSizes.A4;
  const scale = Math.min(a4Width / cell.width, (a4Height - topMargin) / cell.height);
  const page = target.addPage([a4Width, a4Height]);
  page.drawPage(cell, {
    x: 0,
    y: a4Height - cell.height * scale - topMargin,
    width: cell.width * scale,
    height: cell.height * scale,
  });
}
