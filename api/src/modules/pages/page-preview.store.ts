/**
 * Persistent, CDN-addressable source-page previews. This is deliberately distinct from question
 * image crops: previews are a cache of a PDF page and may always be regenerated from Drive.
 */
export interface PagePreviewStore {
  find(documentId: string, page: number): Promise<string | null>;
  save(documentId: string, page: number, bytes: Buffer): Promise<string>;
}
