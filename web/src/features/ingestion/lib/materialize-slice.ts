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
  const [artifact] = await materializePageGroups(pdfBytes, [pageNumbers]);
  if (!artifact) throw new Error('Could not create the page attachment.');
  return artifact;
}

/** Parse the working PDF once when applying all question-page assignments together. */
export async function materializePageGroups(
  pdfBytes: PdfInput,
  groups: readonly number[][],
): Promise<MaterializedArtifact[]> {
  if (!groups.length) return [];
  const source = await PDFDocument.load(pdfBytes.slice(0));
  const artifacts: MaterializedArtifact[] = [];
  for (const pageNumbers of groups) {
    if (
      !pageNumbers.length ||
      pageNumbers.some(
        (page) => !Number.isInteger(page) || page < 1 || page > source.getPageCount(),
      )
    )
      throw new Error('A page assignment is outside the loaded PDF. Review the page numbers.');
    const out = await PDFDocument.create();
    const indices = pageNumbers.map((n) => n - 1);
    const copied = await out.copyPages(source, indices);
    for (const page of copied) out.addPage(page);
    artifacts.push({
      id: makeId(),
      bytes: await out.save(),
      pageCount: pageNumbers.length,
      pageNumbers: [...pageNumbers],
      sourceLabel: pageRangeLabel(pageNumbers),
    });
  }
  return artifacts;
}
