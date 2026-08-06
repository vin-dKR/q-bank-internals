import { type PDFDocument as PDFDocumentType, PDFDocument, PageSizes, rgb } from 'pdf-lib';
import type { CropRect, ReflowBlock } from '../types/reflow-block.js';
import { type PdfInput, embedCell } from './cut-pdf.js';

const MARGIN = 28; // points of page margin around a stacked block
const GAP = 10; // points between stacked fragments
const WHITE = rgb(1, 1, 1);

/** Stack a block's crops onto a fresh A4 page in `out`, scaled to fit. Returns false if empty. */
async function stackBlockPage(
  out: PDFDocumentType,
  src: PDFDocumentType,
  block: ReflowBlock,
): Promise<boolean> {
  const embeds = [];
  for (const crop of block.crops) {
    const cell = await embedCell(out, src, {
      pageNumber: crop.page,
      x0: crop.x0,
      x1: crop.x1,
      start: crop.y0,
      end: crop.y1,
    });
    if (cell) embeds.push(cell);
  }
  if (embeds.length === 0) return false;

  const [a4Width, a4Height] = PageSizes.A4;
  const stackWidth = Math.max(...embeds.map((e) => e.width));
  const stackHeight = embeds.reduce((sum, e) => sum + e.height, 0) + GAP * (embeds.length - 1);
  const scale = Math.min((a4Width - 2 * MARGIN) / stackWidth, (a4Height - 2 * MARGIN) / stackHeight, 1);

  const page = out.addPage([a4Width, a4Height]);
  let y = a4Height - MARGIN;
  for (const cell of embeds) {
    const w = cell.width * scale;
    const h = cell.height * scale;
    page.drawPage(cell, { x: MARGIN, y: y - h, width: w, height: h });
    y -= h + GAP * scale;
  }
  return true;
}

/**
 * Interleave the reflow blocks into the whole document (PDF_CM's "original + a page per block"):
 * every source page is kept, the regions each crop came from are painted white so nothing is read
 * twice, and each block's stacked page is inserted right after the last page it spans. This pulls a
 * question and the options that spilled onto the next page onto one clean page while leaving the rest
 * of the paper intact.
 */
export async function applyReflow(pdfBytes: PdfInput, blocks: ReflowBlock[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdfBytes.slice(0));
  const out = await PDFDocument.create();
  const pageCount = src.getPageCount();
  const live = blocks.filter((b) => b.crops.length > 0);

  // Anchor each block after the last page it spans; collect the regions to white out per page.
  const anchored = new Map<number, ReflowBlock[]>();
  const painted = new Map<number, CropRect[]>();
  const push = <T>(map: Map<number, T[]>, key: number, value: T): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const block of live) {
    push(anchored, Math.max(...block.crops.map((c) => c.page)), block);
    for (const crop of block.crops) push(painted, crop.page, crop);
  }

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const [copied] = await out.copyPages(src, [pageNumber - 1]);
    if (copied) {
      out.addPage(copied);
      const { width, height } = copied.getSize();
      for (const crop of painted.get(pageNumber) ?? []) {
        // PDF origin is bottom-left, so a top-fraction crop maps to y = height·(1 − bottomFraction).
        copied.drawRectangle({
          x: width * crop.x0,
          y: height * (1 - crop.y1),
          width: width * (crop.x1 - crop.x0),
          height: height * (crop.y1 - crop.y0),
          color: WHITE,
          borderWidth: 0,
        });
      }
    }
    for (const block of anchored.get(pageNumber) ?? []) {
      await stackBlockPage(out, src, block);
    }
  }

  return out.save();
}
