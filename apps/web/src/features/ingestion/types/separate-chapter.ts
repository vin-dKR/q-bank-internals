import type { ChapterKind } from '@ingest/contracts';

/**
 * The "three separate files" upload mode: one chapter's independent PDF for each kind. Question is
 * required; answer and explanation (solution) are optional. On continue, each chapter's files are
 * concatenated (question → answer → explanation) into one aggregated PDF that flows into the shared
 * cut & tag workspace — so metadata and slice tags are captured there, exactly like the single-PDF
 * flow. See {@link aggregateSeparateChapters}.
 */
export type SeparateFiles = Record<ChapterKind, File | null>;

export function emptySeparateFiles(): SeparateFiles {
  return { question: null, answer: null, solution: null };
}

/** One chapter in a multi-chapter separate-files batch: its three PDFs (metadata comes later). */
export type SeparateChapter = {
  id: string;
  files: SeparateFiles;
};

export function emptySeparateChapter(id: string): SeparateChapter {
  return { id, files: emptySeparateFiles() };
}

/** The upload kinds shown as the three drop zones, in display order, with human labels. */
export const SEPARATE_FILE_SLOTS: { kind: ChapterKind; label: string; required: boolean }[] = [
  { kind: 'question', label: 'Question PDF', required: true },
  { kind: 'answer', label: 'Answer PDF', required: false },
  { kind: 'solution', label: 'Explanation PDF', required: false },
];
