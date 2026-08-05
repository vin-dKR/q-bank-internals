/**
 * Page-rendering PORT (§3), owned by the questions module. The figure detector needs the source page
 * as a PNG to reason about; the questions service depends on this port rather than the pages module
 * directly, so the two stay decoupled. Satisfied in the composition root by {@link PagesService},
 * whose `renderPage` already rasterizes-and-caches a document's PDF pages.
 */
export interface PageRenderer {
  /** Render one page of a document's source PDF as a PNG. Throws if the document or page is missing. */
  renderPage(documentId: string, page: number): Promise<Buffer>;
}
