import type { ChapterVocabulary } from '../hooks/use-chapter-vocabulary.js';
import type { ChapterMetadataDraft } from '../types/chapter-group.js';

/**
 * Compute the metadata patch for a change to one dependent field (exam → subject → module → chapter →
 * section), clearing any descendant the new parent no longer allows. This is what stops a chapter from
 * outliving the module it belonged to when the module is changed.
 *
 * A descendant is cleared only when the new parent is a *known* value whose recorded child set
 * excludes it. While the operator is still typing an unknown/partial parent, that parent's children
 * fall back to the full list (see {@link ChapterVocabulary}), so the descendant stays valid and is
 * never wiped mid-keystroke — only a deliberate switch to a different known parent clears it.
 */
export function cascadeMetadata(
  field: 'exam' | 'subject' | 'module' | 'chapter',
  next: string,
  draft: ChapterMetadataDraft,
  vocab: ChapterVocabulary,
): Partial<ChapterMetadataDraft> {
  const patch: Partial<ChapterMetadataDraft> = { [field]: next };

  if (field === 'exam' && draft.subject && !vocab.subjectsFor(next).includes(draft.subject)) {
    patch.subject = '';
    patch.module = '';
    patch.chapter = '';
    patch.sectionName = '';
  } else if (field === 'subject' && draft.module && !vocab.modulesFor(next).includes(draft.module)) {
    patch.module = '';
    patch.chapter = '';
    patch.sectionName = '';
  } else if (field === 'module' && draft.chapter && !vocab.chaptersFor(next).includes(draft.chapter)) {
    patch.chapter = '';
    patch.sectionName = '';
  } else if (field === 'chapter' && draft.sectionName && !vocab.sectionsFor(draft.module, next).includes(draft.sectionName)) {
    patch.sectionName = '';
  }

  return patch;
}
