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

/**
 * One question-type block being edited inside a topic: a predefined type over a span of source pages
 * (within the chapter's range). `questionType` starts blank and must be picked from
 * `KNOWN_QUESTION_TYPES` before upload — the config never carries an invented type.
 */
export type TopicTypeDraft = {
  id: string;
  questionType: string;
  from: number;
  to: number;
};

/** One topic being edited inside a chapter: its name plus its question-type blocks. */
export type TopicDraft = {
  id: string;
  name: string;
  types: TopicTypeDraft[];
};

/**
 * One chapter: a page range, its metadata, per-slice question/answer tags, and the optional
 * topic-level structure (Chapter → Topic → Question type). No topics = the plain chapter-wise flow.
 */
export type ChapterGroup = {
  id: string;
  from: number;
  to: number;
  metadata: ChapterMetadataDraft;
  tags: SliceTags;
  topics: TopicDraft[];
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
