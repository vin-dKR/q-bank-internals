import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { EditorElement } from '../types.js';

/** Parse `#rgb`/`#rrggbb` into a pdf-lib colour (defaults to black on anything unexpected). */
function hexColor(hex: string): ReturnType<typeof rgb> {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(int)) return rgb(0, 0, 0);
  return rgb(((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255);
}

/**
 * Stamp the overlay elements back into the PDF and return the edited bytes. Element geometry is in
 * base render pixels; per page we convert with `ptPerPx = pageWidthPt / pageWidthPx` and flip the
 * y-axis (DOM top-left → PDF bottom-left). Text uses Helvetica; images embed as PNG or JPG by MIME.
 */
export async function exportEditedPdf(
  source: ArrayBuffer,
  elements: EditorElement[],
  pageWidthPx: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source.slice(0));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const element of elements) {
    const page = pages[element.page - 1];
    if (!page) continue;
    const { width: pageWidthPt, height: pageHeightPt } = page.getSize();
    const ptPerPx = pageWidthPt / pageWidthPx;
    const x = element.x * ptPerPx;
    const w = element.w * ptPerPx;
    const h = element.h * ptPerPx;

    if (element.type === 'text') {
      const size = element.fontSize * ptPerPx;
      // pdf-lib draws from the text baseline; the element's y is its top, so drop one line down.
      const baseline = pageHeightPt - element.y * ptPerPx - size;
      page.drawText(element.text, {
        x,
        y: baseline,
        size,
        font,
        color: hexColor(element.color),
        lineHeight: size * 1.15,
      });
    } else {
      const image = element.dataUrl.startsWith('data:image/png')
        ? await doc.embedPng(element.dataUrl)
        : await doc.embedJpg(element.dataUrl);
      page.drawImage(image, { x, y: pageHeightPt - element.y * ptPerPx - h, width: w, height: h });
    }
  }

  return doc.save();
}
