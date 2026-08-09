import { PDFDocument } from 'pdf-lib';
import type { PdfInput } from './cut-pdf.js';

/**
 * Drop one 1-based page from a PDF, returning fresh bytes. This is the pipeline's page-level
 * eraser: it removes a page a transform left empty (e.g. the source page a reflow block stacked
 * out of) or an unwanted slice once a grid cut has turned each slice into its own page. Refuses to
 * delete the only remaining page — a zero-page PDF has nothing to preview or upload.
 */
export async function deletePage(pdfBytes: PdfInput, pageNumber: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes.slice(0));
  const pageCount = pdf.getPageCount();
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new Error(`Page ${String(pageNumber)} is out of range (1–${String(pageCount)}).`);
  }
  if (pageCount === 1) {
    throw new Error('Cannot delete the only page.');
  }
  pdf.removePage(pageNumber - 1);
  return pdf.save();
}

/**
 * Drop several 1-based pages in one pass (the operator selected a batch and hit "Delete selected").
 * Removes in descending order so each `removePage` index stays valid as earlier pages are dropped.
 * Refuses to empty the document — at least one page must survive, same invariant as {@link deletePage}.
 */
export async function deletePages(pdfBytes: PdfInput, pageNumbers: readonly number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes.slice(0));
  const pageCount = pdf.getPageCount();
  const unique = [...new Set(pageNumbers)].sort((a, b) => b - a);
  for (const pageNumber of unique) {
    if (pageNumber < 1 || pageNumber > pageCount) {
      throw new Error(`Page ${String(pageNumber)} is out of range (1–${String(pageCount)}).`);
    }
  }
  if (unique.length >= pageCount) {
    throw new Error('Cannot delete every page — keep at least one.');
  }
  for (const pageNumber of unique) pdf.removePage(pageNumber - 1);
  return pdf.save();
}
