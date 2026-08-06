import { pdf } from 'pdf-to-img';
import type { PageImage, PdfRasterizer } from '../../modules/extraction/index.js';

/**
 * {@link PdfRasterizer} backed by `pdf-to-img` (pdfjs + canvas), the Node stand-in for the Python
 * extractor's PyMuPDF rasterization. `scale: 3` (~216 DPI) keeps the images sharp enough for the
 * vision model without ballooning token cost; raise it if fine print is being misread.
 */
export class PdfToImgRasterizer implements PdfRasterizer {
  constructor(private readonly scale = 3) {}

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
