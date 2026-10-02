import type { PageImage } from './vision-extractor.js';

/**
 * The PDF-rasterization PORT (§3), owned by the extraction module. Turns a PDF's bytes into one PNG
 * per page — the images the vision model consumes. Implemented in `infrastructure/pdf`. Runs in the
 * worker, never the API.
 */
export interface PdfRasterizer {
  /** Inspect metadata without rendering all pages into memory. */
  pageCount(pdf: Buffer): Promise<number>;
  /** Render exactly one page — the production queue never builds a full-PDF image array. */
  rasterizePage(pdf: Buffer, pageNumber: number): Promise<PageImage>;
  /** Render a small explicit batch without materialising every PDF page. */
  rasterizePages(pdf: Buffer, pageNumbers: number[]): Promise<PageImage[]>;
  rasterize(pdf: Buffer): Promise<PageImage[]>;
}
