import { type PDFDocument as PDFDocumentType, type PDFEmbeddedPage, PDFDocument, PageSizes } from 'pdf-lib';

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

const TOP_MARGIN = 72; // 1-inch top margin (72 points) on every slice after the first
const EPSILON = 1e-4; // fractions closer than this bound a zero-area cell — nothing to draw

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
  const { width, height } = page.getSize();
  const left = width * (slice.x0 ?? 0);
  const right = width * (slice.x1 ?? 1);
  // PDF coordinates put the origin bottom-left, so a fraction from the top flips into height − f·height.
  const bottom = height * (1 - slice.end);
  const top = height * (1 - slice.start);
  if (right - left <= EPSILON || top - bottom <= EPSILON) return null;
  return target.embedPage(page, { left, bottom, right, top });
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

/**
 * Build a single PDF from cells of a source PDF: each cell is cropped, reflowed onto its own A4
 * page, and appended. Used to split a chapter's tagged slices into question/answer PDFs.
 */
export async function buildPdfFromSlices(pdfBytes: PdfInput, slices: Slice[]): Promise<Uint8Array> {
  const origPdf = await PDFDocument.load(pdfBytes.slice(0));
  const mergedPdf = await PDFDocument.create();

  for (let idx = 0; idx < slices.length; idx += 1) {
    const slice = slices[idx];
    if (!slice) continue;
    const cell = await embedCell(mergedPdf, origPdf, slice);
    if (!cell) continue;
    drawCellOnA4(mergedPdf, cell, idx > 0 ? TOP_MARGIN : 0);
  }

  return mergedPdf.save();
}
