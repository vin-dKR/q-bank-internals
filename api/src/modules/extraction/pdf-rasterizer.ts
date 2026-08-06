import type { PageImage } from './vision-extractor.js';

/**
 * The PDF-rasterization PORT (§3), owned by the extraction module. Turns a PDF's bytes into one PNG
 * per page — the images the vision model consumes. Implemented in `infrastructure/pdf`. Runs in the
 * worker, never the API.
 */
export interface PdfRasterizer {
  rasterize(pdf: Buffer): Promise<PageImage[]>;
}
