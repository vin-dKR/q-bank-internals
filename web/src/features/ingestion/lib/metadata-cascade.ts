import type { ChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';
import { shouldCollectClassName } from '@ingest/contracts';

/**
 * Compute the metadata patch for a change to one dependent field (module → exam → subject → chapter),
 * clearing any descendant the new parent no longer allows.
 *
 * Modules are independent provider names. Chapters alone are scoped to a SUBJECT (exam does not narrow
 * the global subject list, and module does not narrow chapters). So a change can orphan a descendant
 * only when the SUBJECT switches: drop a chapter the newly chosen subject does not contain. A descendant
 * is cleared only when the new subject is a known value
 * whose recorded child set excludes it — while the operator types an unknown/partial subject, children
 * fall back to the full list (see {@link ChapterVocabulary}), so nothing is wiped mid-keystroke.
 */
export function cascadeMetadata(
  field: 'exam' | 'subject' | 'module' | 'chapter',
  next: string,
  draft: ChapterMetadataDraft,
  vocab: ChapterVocabulary,
): Partial<ChapterMetadataDraft> {
  const patch: Partial<ChapterMetadataDraft> = { [field]: next };

  // A class has meaning only for board-level or NCERT material. Drop a stale value when either
  // controlling field changes away from that scope.
  const proposedExam = field === 'exam' ? next : draft.exam;
  const proposedModule = field === 'module' ? next : draft.module;
  if ((field === 'exam' || field === 'module') && !shouldCollectClassName(proposedExam, proposedModule)) {
    patch.className = '';
  }

  if (field === 'subject') {
    if (draft.chapter && !vocab.chaptersFor(next).includes(draft.chapter)) patch.chapter = '';
  }

  return patch;
}
