import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

/** Copy the given 0-based page indices of `src` into a fresh PDF and return its bytes. */
async function subsetPdf(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((page) => out.addPage(page));
  return out.save();
}

/** A filesystem-safe stem from the desired name, defaulting to `qna`. */
function stem(name: string): string {
  return (name.trim() || 'qna').replace(/[\\/:*?"<>|]+/g, '_');
}

/**
 * Split `source` by selection into a zip: the selected pages become `<name>-answer.pdf`, the rest
 * `<name>-question.pdf`. Each file is emitted only when it has pages. `selected` holds 1-based numbers.
 */
export async function buildQnaZip(
  source: ArrayBuffer,
  selected: ReadonlySet<number>,
  name: string,
): Promise<Blob> {
  const src = await PDFDocument.load(source.slice(0));
  const total = src.getPageCount();
  const answer: number[] = [];
  const question: number[] = [];
  for (let i = 0; i < total; i++) (selected.has(i + 1) ? answer : question).push(i);

  const base = stem(name);
  const zip = new JSZip();
  if (answer.length > 0) zip.file(`${base}-answer.pdf`, await subsetPdf(src, answer));
  if (question.length > 0) zip.file(`${base}-question.pdf`, await subsetPdf(src, question));
  return zip.generateAsync({ type: 'blob' });
}
