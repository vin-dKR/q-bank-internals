import sharp from 'sharp';
import { logger } from '../../shared/logger/logger.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from '../documents/index.js';
import type { DriveService } from '../drive/index.js';
import type { PdfRasterizer } from '../extraction/index.js';
import type { PagePreviewStore } from './page-preview.store.js';

export type SourcePagePreview = { url: string } | { png: Buffer };

/**
 * Serves the Verify crop canvas without ever rasterizing an entire PDF request. Extraction writes
 * its pages into the persistent preview cache; old documents are migrated lazily on first view.
 */
export class PagesService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly drive: DriveService,
    private readonly rasterizer: PdfRasterizer,
    private readonly previews: PagePreviewStore,
  ) {}

  /** Return a public CDN URL when cached, otherwise render and cache only the requested page. */
  async previewPage(documentId: string, page: number): Promise<SourcePagePreview> {
    const cached = await this.findCached(documentId, page);
    if (cached) return { url: cached };
    const png = await this.renderPage(documentId, page);
    const url = await this.cacheRenderedPage(documentId, page, png);
    return url ? { url } : { png };
  }

  /** Render exactly one PDF page for crop/re-extraction paths that need original PNG pixels. */
  async renderPage(documentId: string, page: number): Promise<Buffer> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    const pdf = await this.drive.downloadPdf(document.driveFileId);
    try {
      return (await this.rasterizer.rasterizePage(pdf, page)).png;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('PDF page ')) throw errors.pageNotFound(documentId, page);
      throw error;
    }
  }

  /** Page count is PDF metadata, not a request to generate every image. */
  async pageCount(documentId: string): Promise<number> {
    const document = await this.documents.findById(documentId);
    if (!document) throw errors.documentNotFound(documentId);
    const pdf = await this.drive.downloadPdf(document.driveFileId);
    return this.rasterizer.pageCount(pdf);
  }

  /** Called by the extraction queue while the high-resolution page pixels are already in memory. */
  async cacheRenderedPage(documentId: string, page: number, png: Buffer): Promise<string | null> {
    try {
      const webp = await sharp(png).webp({ quality: 84, effort: 4 }).toBuffer();
      return await this.previews.save(documentId, page, webp);
    } catch (error) {
      logger.warn(
        { documentId, page, err: error instanceof Error ? error.message : String(error) },
        'Source-page preview cache write failed; serving the rendered page directly',
      );
      return null;
    }
  }

  private async findCached(documentId: string, page: number): Promise<string | null> {
    try {
      return await this.previews.find(documentId, page);
    } catch (error) {
      logger.warn(
        { documentId, page, err: error instanceof Error ? error.message : String(error) },
        'Source-page preview cache lookup failed; rendering the requested page',
      );
      return null;
    }
  }
}
