import { pdf } from 'pdf-to-img';
import type { PageImage, PdfRasterizer, SourcePageLayout } from '../../modules/extraction/index.js';
import { readNativePageSources } from './page-layout.js';
import { logger } from '../../shared/logger/logger.js';

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
    return Promise.all(pageNumbers.map(async (pageNumber): Promise<PageImage> => {
      const png = await document.getPage(pageNumber);
      return { pageNumber, png, ...await this.nativeSources(bytes, pageNumber, png) };
    }));
  }

  async rasterize(bytes: Buffer): Promise<PageImage[]> {
    const document = await pdf(bytes, { scale: this.scale });
    const pages: PageImage[] = [];
    let pageNumber = 0;
    for await (const png of document) {
      pageNumber += 1;
      pages.push({ pageNumber, png, ...await this.nativeSources(bytes, pageNumber, png) });
    }
    return pages;
  }

  private async nativeSources(bytes: Buffer, pageNumber: number, png: Buffer): Promise<{ layout: SourcePageLayout | null; nativeChoiceKeys: Record<string, string> | null }> {
    try {
      const sources = await readNativePageSources(bytes, pageNumber, png);
      return { layout: sources.layout, nativeChoiceKeys: sources.choiceKeys };
    }
    catch (error) {
      logger.warn({ err: error, pageNumber }, 'Native source layout unavailable; retaining the image for localization review');
      return { layout: null, nativeChoiceKeys: null };
    }
  }
}
