import type { ChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

/**
 * Compute the metadata patch for a change to one dependent field (exam → subject → module → chapter),
 * clearing any descendant the new parent no longer allows.
 *
 * The all-masters dictionaries scope modules and chapters to a SUBJECT only (exam does not narrow the
 * global subject list, and module does not narrow chapters — both are direct children of the subject).
 * So a change can orphan a descendant only when the SUBJECT switches: drop any module/chapter the newly
 * chosen subject does not contain. A descendant is cleared only when the new subject is a known value
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

  if (field === 'subject') {
    if (draft.module && !vocab.modulesFor(next).includes(draft.module)) patch.module = '';
    if (draft.chapter && !vocab.chaptersFor(next).includes(draft.chapter)) patch.chapter = '';
  }

  return patch;
}
