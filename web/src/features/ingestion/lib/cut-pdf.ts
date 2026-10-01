import {
  type PDFDocument as PDFDocumentType,
  type PDFEmbeddedPage,
  type PageBoundingBox,
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

/** The shared clip geometry also lets the cutter embed pages already copied into its output. */
export function cellBounds(
  size: { width: number; height: number },
  slice: Slice,
): PageBoundingBox | null {
  const { width, height } = size;
  const left = width * (slice.x0 ?? 0);
  const right = width * (slice.x1 ?? 1);
  // PDF coordinates start at the bottom-left; the crop's fractions start at the top.
  const bottom = height * (1 - slice.end);
  const top = height * (1 - slice.start);
  return right - left <= EPSILON || top - bottom <= EPSILON ? null : { left, bottom, right, top };
}

/**
 * Embed a source page's cell as a vector form XObject cropped on both axes (the pdf-lib equivalent
 * of PyMuPDF's `show_pdf_page(..., clip=...)`), so text stays selectable rather than rasterised.
 * Returns null for a zero-area cell (adjacent cut lines).
 */
export async function embedCell(
  target: PDFDocumentType,
  source: PDFDocumentType,
  slice: Slice,
): Promise<PDFEmbeddedPage | null> {
  const page = source.getPage(slice.pageNumber - 1);
  const bounds = cellBounds(page.getSize(), slice);
  return bounds ? target.embedPage(page, bounds) : null;
}

/** Add one A4 page and draw the embedded cell scaled to fit under an optional top margin. */
export function drawCellOnA4(target: PDFDocumentType, cell: PDFEmbeddedPage, topMargin: number): void {
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
