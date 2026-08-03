import { PDFDocument, PageSizes } from 'pdf-lib';

/** A horizontal slice of a source page, as 0–1 fractions measured from the top of the page. */
export type Slice = {
  pageNumber: number; // 1-based
  start: number; // top of the slice (0 = page top)
  end: number; // bottom of the slice (1 = page bottom)
};

const TOP_MARGIN = 72; // 1-inch top margin (72 points) on every slice after the first

/**
 * Build a single PDF from horizontal slices of a source PDF: each slice is cropped, reflowed onto
 * its own A4 page, and appended. Ported from the standalone pdf-page-cutter export algorithm,
 * generalized to an explicit slice list (so questions and answers can be built separately).
 */
export async function buildPdfFromSlices(
  pdfBytes: ArrayBuffer,
  slices: Slice[],
): Promise<Uint8Array> {
  const origPdf = await PDFDocument.load(pdfBytes.slice(0));
  const mergedPdf = await PDFDocument.create();
  const [a4Width, a4Height] = PageSizes.A4;

  for (let idx = 0; idx < slices.length; idx += 1) {
    const slice = slices[idx];
    if (!slice) continue;

    const page = origPdf.getPage(slice.pageNumber - 1);
    const { width, height } = page.getSize();

    const yStart = height * (1 - slice.start);
    const yEnd = height * (1 - slice.end);
    if (yStart <= yEnd) continue;
    const cropHeight = yStart - yEnd;

    const tempDoc = await PDFDocument.create();
    const [copiedPage] = await tempDoc.copyPages(origPdf, [slice.pageNumber - 1]);
    if (!copiedPage) continue;
    copiedPage.setMediaBox(0, 0, width, cropHeight);
    copiedPage.translateContent(0, -yEnd);
    tempDoc.addPage(copiedPage);

    const [embeddedSlice] = await mergedPdf.embedPdf(await tempDoc.save());
    if (!embeddedSlice) continue;

    const margin = idx > 0 ? TOP_MARGIN : 0;
    const scale = Math.min(
      a4Width / embeddedSlice.width,
      (a4Height - margin) / embeddedSlice.height,
    );
    const a4Page = mergedPdf.addPage([a4Width, a4Height]);
    a4Page.drawPage(embeddedSlice, {
      x: 0,
      y: a4Height - embeddedSlice.height * scale - margin,
      width: embeddedSlice.width * scale,
      height: embeddedSlice.height * scale,
    });
  }

  return mergedPdf.save();
}
