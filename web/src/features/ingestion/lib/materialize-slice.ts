import { PDFDocument } from 'pdf-lib';
import type { MaterializedArtifact } from '../types/structure-node.js';
import type { PdfInput } from './cut-pdf.js';
import { makeId } from './make-id.js';

/** "page 3" / "pages 3–5" (contiguous) / "3 pages" (scattered) — provenance shown on the binding. */
function labelForPages(pageNumbers: number[]): string {
  if (pageNumbers.length === 0) return 'no pages';
  if (pageNumbers.length === 1) return `page ${String(pageNumbers[0])}`;
  const sorted = [...pageNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const contiguous =
    first !== undefined && last !== undefined && last - first === sorted.length - 1;
  return contiguous ? `pages ${String(first)}–${String(last)}` : `${String(sorted.length)} pages`;
}

/**
 * Snapshot the given 1-based pages of the working document into a standalone, immutable PDF — the
 * materialization step behind "drag a finalized slice onto a leaf". The returned artifact owns its
 * own bytes, so re-cutting, deleting, or replacing the working document afterwards cannot touch it.
 */
export async function materializePages(
  pdfBytes: PdfInput,
  pageNumbers: number[],
): Promise<MaterializedArtifact> {
  const source = await PDFDocument.load(pdfBytes.slice(0));
  const out = await PDFDocument.create();
  const indices = pageNumbers.map((n) => n - 1);
  const copied = await out.copyPages(source, indices);
  for (const page of copied) out.addPage(page);
  return {
    id: makeId(),
    bytes: await out.save(),
    pageCount: pageNumbers.length,
    sourceLabel: labelForPages(pageNumbers),
  };
}
