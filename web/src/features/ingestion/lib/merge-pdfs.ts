import { PDFDocument } from 'pdf-lib';

/** One source PDF's inclusive 1-based page span within a merged document. */
export type MergeSpan = { from: number; to: number };

/** Append every page of `source` to `out` (in order), returning its inclusive 1-based page span. */
export async function appendPdf(out: PDFDocument, source: Uint8Array): Promise<MergeSpan> {
  const src = await PDFDocument.load(source);
  const copied = await out.copyPages(src, src.getPageIndices());
  const from = out.getPageCount() + 1;
  for (const page of copied) out.addPage(page);
  return { from, to: out.getPageCount() };
}

/**
 * Concatenate PDFs in selection order into one document, returning the merged bytes and each
 * source's page span — the single pdf-lib merge primitive shared by chapter assembly and the
 * multi-PDF uploader.
 */
export async function mergePdfs(sources: Uint8Array[]): Promise<{ bytes: Uint8Array; spans: MergeSpan[] }> {
  const out = await PDFDocument.create();
  const spans: MergeSpan[] = [];
  for (const source of sources) spans.push(await appendPdf(out, source));
  return { bytes: await out.save(), spans };
}
