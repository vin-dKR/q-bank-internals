import type { ChapterKind } from '@ingest/contracts';
import { type ChapterMetadataDraft, emptyMetadata } from './chapter-group.js';

/**
 * The "three separate files" upload mode: one chapter's independent PDF for each kind. Question is
 * required; answer and explanation (solution) are optional. All three are cropped, then filed under
 * the same chapter unit (metadata captured after the crop) so the extractor links answers and
 * explanations back to the questions by their printed number.
 */
export type SeparateFiles = Record<ChapterKind, File | null>;

export function emptySeparateFiles(): SeparateFiles {
  return { question: null, answer: null, solution: null };
}

/**
 * One chapter in a multi-chapter separate-files batch: its three PDFs plus the metadata captured
 * after cropping. Every chapter files under its own unit — `(module, chapter, section)` — which the
 * extractor uses to keep each chapter's answers/explanations bound to its own questions. Two chapters
 * must therefore resolve to distinct units; the finalize step enforces that.
 */
export type SeparateChapter = {
  id: string;
  metadata: ChapterMetadataDraft;
  files: SeparateFiles;
};

export function emptySeparateChapter(id: string): SeparateChapter {
  return { id, metadata: emptyMetadata(), files: emptySeparateFiles() };
}

/** The normalized unit key `(module | chapter | section)` two chapters must not share. */
export function chapterUnitKey(metadata: ChapterMetadataDraft): string {
  const norm = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return [norm(metadata.module), norm(metadata.chapter), norm(metadata.sectionName)].join(' | ');
}

/** The upload kinds shown as the three input boxes, in display order, with human labels. */
export const SEPARATE_FILE_SLOTS: { kind: ChapterKind; label: string; required: boolean }[] = [
  { kind: 'question', label: 'Question PDF', required: true },
  { kind: 'answer', label: 'Answer PDF', required: false },
  { kind: 'solution', label: 'Explanation PDF', required: false },
];
