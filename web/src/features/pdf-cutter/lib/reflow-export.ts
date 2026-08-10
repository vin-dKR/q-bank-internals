import { PDFDocument, PageSizes } from 'pdf-lib';
import type { SplitPoint } from '../types.js';

/** 1-inch (72pt) top margin on every slice after the first from a page (matches the source cutter). */
const TOP_MARGIN = 72;

/** Group horizontal split positions by 1-based page number, each list sorted top→bottom. */
export function horizontalSplitsByPage(splits: SplitPoint[]): Map<number, number[]> {
  const byPage = new Map<number, number[]>();
  for (const split of splits) {
    if (split.orientation !== 'horizontal') continue;
    const list = byPage.get(split.page) ?? [];
    list.push(split.position);
    byPage.set(split.page, list);
  }
  for (const list of byPage.values()) list.sort((a, b) => a - b);
  return byPage;
}

/**
 * Cut every page at its horizontal split lines and reflow each slice onto its own A4 page (scaled to
 * fit, with a top margin on continuation slices), producing one merged PDF's bytes. Vertical guides
 * are ignored here — like the source tool, they are on-screen aids only. A page with no splits copies
 * through as a single full-height slice.
 */
export async function buildMergedPdf(source: ArrayBuffer, splits: SplitPoint[]): Promise<Uint8Array> {
  const orig = await PDFDocument.load(source.slice(0));
  const merged = await PDFDocument.create();
  const byPage = horizontalSplitsByPage(splits);
  const [a4Width, a4Height] = PageSizes.A4;

  for (let pageIndex = 0; pageIndex < orig.getPageCount(); pageIndex++) {
    const { width, height } = orig.getPage(pageIndex).getSize();
    const boundaries = [0, ...(byPage.get(pageIndex + 1) ?? []), 1];

    for (let i = 0; i < boundaries.length - 1; i++) {
      const yStart = height * (1 - (boundaries[i] ?? 0));
      const yEnd = height * (1 - (boundaries[i + 1] ?? 1));
      if (yStart <= yEnd) continue;
      const cropHeight = yStart - yEnd;

      // Crop a copy of the page down to this band, then embed it as a stamp on a fresh A4 page.
      const tempDoc = await PDFDocument.create();
      const [copied] = await tempDoc.copyPages(orig, [pageIndex]);
      if (!copied) continue;
      copied.setMediaBox(0, 0, width, cropHeight);
      copied.translateContent(0, -yEnd);
      tempDoc.addPage(copied);
      const [embedded] = await merged.embedPdf(await tempDoc.save());
      if (!embedded) continue;

      const a4Page = merged.addPage([a4Width, a4Height]);
      const margin = i > 0 ? TOP_MARGIN : 0;
      const scale = Math.min(a4Width / embedded.width, (a4Height - margin) / embedded.height);
      a4Page.drawPage(embedded, {
        x: 0,
        y: a4Height - embedded.height * scale - margin,
        width: embedded.width * scale,
        height: embedded.height * scale,
      });
    }
  }

  return merged.save();
}
