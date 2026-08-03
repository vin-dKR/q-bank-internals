import type { Exam, Module } from '@ingest/contracts';
import type { SliceTags } from '../lib/build-chapter-pdfs.js';

/** Editable metadata for one chapter before it is validated into a ChapterUploadMetadata. */
export type ChapterMetadataDraft = {
  exam: Exam | '';
  subject: string;
  module: Module | '';
  chapter: string;
  sectionName: string;
  questionType: string;
};

/** One chapter: a page range, its metadata, and per-slice question/answer tags. */
export type ChapterGroup = {
  id: string;
  from: number;
  to: number;
  metadata: ChapterMetadataDraft;
  tags: SliceTags;
};

export function emptyMetadata(): ChapterMetadataDraft {
  return { exam: '', subject: '', module: '', chapter: '', sectionName: '', questionType: '' };
}

/** The chapter (if any) that owns a given page, resolved for the on-page slice overlay. */
export type PageChapterInfo = {
  chapterId: string;
  chapterIndex: number;
  tags: SliceTags;
} | null;

/** The chapter owning `pageNumber`, or null when the page is in no chapter range. */
export function chapterForPage(groups: ChapterGroup[], pageNumber: number): PageChapterInfo {
  const index = groups.findIndex(
    (group) => pageNumber >= group.from && pageNumber <= group.to,
  );
  const group = groups[index];
  if (!group) return null;
  return { chapterId: group.id, chapterIndex: index, tags: group.tags };
}
