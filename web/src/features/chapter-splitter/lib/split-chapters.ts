import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

/** One named page range to carve out, `start`/`end` are 1-based inclusive page numbers. */
export type ChapterRange = { id: string; start: number; end: number; name: string };

/** A filesystem-safe file stem for a range: its name, or `chapter_<start>_<end>` when unnamed. */
function fileStem(range: ChapterRange): string {
  const base = range.name.trim() || `chapter_${String(range.start)}_${String(range.end)}`;
  return base.replace(/[\\/:*?"<>|]+/g, '_');
}

/** The 0-based page indices covered by a range, in order. */
function indicesOf(range: ChapterRange): number[] {
  return Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start - 1 + i);
}

/** Copy one range's pages into a fresh single-chapter PDF and return its bytes. */
export async function buildChapterPdf(source: ArrayBuffer, range: ChapterRange): Promise<Uint8Array> {
  const src = await PDFDocument.load(source.slice(0));
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indicesOf(range));
  pages.forEach((page) => out.addPage(page));
  return out.save();
}

/** Build every range into its own PDF and bundle them into one `chapters.zip` blob. */
export async function buildChaptersZip(source: ArrayBuffer, ranges: ChapterRange[]): Promise<Blob> {
  const src = await PDFDocument.load(source.slice(0));
  const zip = new JSZip();
  for (const range of ranges) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, indicesOf(range));
    pages.forEach((page) => out.addPage(page));
    zip.file(`${fileStem(range)}.pdf`, await out.save());
  }
  return zip.generateAsync({ type: 'blob' });
}

/** The download name for a single range's PDF. */
export function chapterFileName(range: ChapterRange): string {
  return `${fileStem(range)}.pdf`;
}
