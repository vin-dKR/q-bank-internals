import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { DriveService } from '../drive/index.js';
import type { PageImage, PdfRasterizer } from '../extraction/index.js';

/**
 * Renders a document's source PDF page as a PNG — the crop canvas the verify screen draws on. The
 * rasterized pages are cached per Drive file (small LRU) so paging through a document is cheap.
 */
export class PagesService {
  private readonly cache = new Map<string, PageImage[]>();
  private readonly order: string[] = [];
  private readonly maxCached = 8;

  constructor(
    private readonly documents: DocumentRepository,
    private readonly drive: DriveService,
    private readonly rasterizer: PdfRasterizer,
  ) {}

  async renderPage(documentId: string, page: number): Promise<Buffer> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    const pages = await this.pagesFor(document.driveFileId);
    const match = pages.find((image) => image.pageNumber === page);
    if (!match) throw errors.pageNotFound(documentId, page);
    return match.png;
  }

  /** How many pages a document's PDF has — lets the verify screen build its page selector. */
  async pageCount(documentId: string): Promise<number> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    const pages = await this.pagesFor(document.driveFileId);
    return pages.length;
  }

  private async pagesFor(driveFileId: string): Promise<PageImage[]> {
    const cached = this.cache.get(driveFileId);
    if (cached) return cached;
    const pdf = await this.drive.downloadPdf(driveFileId);
    const pages = await this.rasterizer.rasterize(pdf);
    this.cache.set(driveFileId, pages);
    this.order.push(driveFileId);
    if (this.order.length > this.maxCached) {
      const evicted = this.order.shift();
      if (evicted) this.cache.delete(evicted);
    }
    return pages;
  }
}
