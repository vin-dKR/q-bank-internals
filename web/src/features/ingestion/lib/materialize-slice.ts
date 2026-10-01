import { PDFDocument } from 'pdf-lib';
import type { MaterializedArtifact } from '../types/structure-node.js';
import type { PdfInput } from './cut-pdf.js';
import { makeId } from './make-id.js';
import { pageRangeLabel } from './page-range.js';

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
    pageNumbers: [...pageNumbers],
    sourceLabel: pageRangeLabel(pageNumbers),
  };
}
