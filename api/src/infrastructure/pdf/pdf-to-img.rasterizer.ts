import { pdf } from 'pdf-to-img';
import type { PageImage, PdfRasterizer } from '../../modules/extraction/index.js';

/**
 * {@link PdfRasterizer} backed by `pdf-to-img` (pdfjs + canvas), the Node stand-in for the Python
 * extractor's PyMuPDF rasterization. `scale: 3` (~216 DPI) keeps the images sharp enough for the
 * vision model without ballooning token cost; raise it if fine print is being misread.
 */
export class PdfToImgRasterizer implements PdfRasterizer {
  constructor(private readonly scale = 3) {}

  async pageCount(bytes: Buffer): Promise<number> {
    const document = await pdf(bytes, { scale: this.scale });
    return document.length;
  }

  async rasterizePage(bytes: Buffer, pageNumber: number): Promise<PageImage> {
    const pages = await this.rasterizePages(bytes, [pageNumber]);
    const page = pages[0];
    if (!page) throw new Error(`PDF page ${String(pageNumber)} could not be rendered.`);
    return page;
  }

  async rasterizePages(bytes: Buffer, pageNumbers: number[]): Promise<PageImage[]> {
    const document = await pdf(bytes, { scale: this.scale });
    for (const pageNumber of pageNumbers) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.length) {
        throw new Error(`PDF page ${String(pageNumber)} is outside 1…${String(document.length)}.`);
      }
    }
    return Promise.all(pageNumbers.map(async (pageNumber) => ({ pageNumber, png: await document.getPage(pageNumber) })));
  }

  async rasterize(bytes: Buffer): Promise<PageImage[]> {
    const document = await pdf(bytes, { scale: this.scale });
    const pages: PageImage[] = [];
    let pageNumber = 0;
    for await (const png of document) {
      pageNumber += 1;
      pages.push({ pageNumber, png });
    }
    return pages;
  }
}
