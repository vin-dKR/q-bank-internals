import { PDFDocument } from 'pdf-lib';
import type { ChapterKind } from '@ingest/contracts';
import type { SeparateChapter } from '../types/separate-chapter.js';
import { type ChapterGroup, emptyMetadata } from '../types/chapter-group.js';
import type { PageKinds } from './build-chapter-pdfs.js';

/** Source order within a chapter block: question pages, then answer, then explanation (solution). */
const KIND_ORDER: ChapterKind[] = ['question', 'answer', 'solution'];

export type AggregateResult = {
  /** The concatenated PDF: each chapter's question → answer → explanation pages, chapters in order. */
  bytes: Uint8Array;
  /** One pre-ranged chapter per input chapter, ready for the cut & tag panel (metadata still blank). */
  groups: ChapterGroup[];
  /** Page → source kind, so a slice cut from an answer/explanation page defaults to that kind. */
  pageKinds: PageKinds;
};

/**
 * Merge each chapter's separate Question / Answer / Explanation PDFs into a single aggregated PDF so
 * the separate-files flow can reuse the single-PDF cut & tag workspace. Pages are laid out per chapter
 * (Ch1: Q→A→E, then Ch2: Q→A→E …) so every chapter is one contiguous page range; the returned
 * `groups` capture those ranges and `pageKinds` records each page's source kind for default tagging.
 */
export async function aggregateSeparateChapters(chapters: SeparateChapter[]): Promise<AggregateResult> {
  const out = await PDFDocument.create();
  const pageKinds: PageKinds = {};
  const groups: ChapterGroup[] = [];
  let pageCount = 0; // running count; the next appended page is numbered pageCount + 1

  for (const chapter of chapters) {
    const from = pageCount + 1;
    for (const kind of KIND_ORDER) {
      const file = chapter.files[kind];
      if (!file) continue;
      const source = await PDFDocument.load(await file.arrayBuffer());
      const indices = source.getPageIndices();
      const copied = await out.copyPages(source, indices);
      for (const page of copied) {
        out.addPage(page);
        pageCount += 1;
        pageKinds[pageCount] = kind;
      }
    }
    // Only chapters that contributed at least one page become a group (question is required upstream).
    if (pageCount >= from) {
      groups.push({ id: chapter.id, from, to: pageCount, metadata: emptyMetadata(), tags: {}, topics: [] });
    }
  }

  const bytes = await out.save();
  return { bytes, groups, pageKinds };
}
