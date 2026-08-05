import type { ChapterKind } from '@ingest/contracts';
import { type ChapterMetadataDraft, emptyMetadata } from './chapter-group.js';

/**
 * One chapter in the "three separate files" upload mode: shared metadata plus an independent PDF for
 * each kind. Question is required; answer and explanation (solution) are optional. All three are
 * filed under the same chapter unit so the extractor links answers/explanations to the questions.
 */
export type SeparateChapter = {
  id: string;
  metadata: ChapterMetadataDraft;
  files: Record<ChapterKind, File | null>;
};

export function emptySeparateChapter(id: string): SeparateChapter {
  return {
    id,
    metadata: emptyMetadata(),
    files: { question: null, answer: null, solution: null },
  };
}

/** The upload kinds shown as the three input boxes, in display order, with human labels. */
export const SEPARATE_FILE_SLOTS: { kind: ChapterKind; label: string; required: boolean }[] = [
  { kind: 'question', label: 'Question PDF', required: true },
  { kind: 'answer', label: 'Answer PDF', required: false },
  { kind: 'solution', label: 'Explanation PDF', required: false },
];
