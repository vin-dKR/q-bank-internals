import type { DictionaryEntry } from '@ingest/contracts';
import type { ComboboxOption } from '../../../shared/ui/index.js';

/**
 * The questionType master's canonical KIND → the behavior SLUG the extraction TYPE_RULES / verify
 * branching (single/multi/matrix …) key on. The dictionary stores 7 canonical kinds (`single`, `multi`,
 * …) while the pipeline speaks the 9-token KNOWN_QUESTION_TYPES vocabulary; the two differ only for
 * single/multi (which get the `_correct` suffix), and true_false/fill_blank fold into `subjective`.
 * Keeping the stored value a slug means the whole server pipeline is untouched — only the OPTIONS the
 * operator chooses from move to the masters dictionary.
 */
const KIND_TO_SLUG: Record<string, string> = {
  single: 'single_correct',
  multi: 'multi_correct',
  matrix: 'matrix',
  comprehension: 'comprehension',
  integer: 'integer',
  subjective: 'subjective',
  assertion_reason: 'assertion_reason',
};

/** The behavior slug for one questionType master row (falls back to its kind, then its key). */
export function questionTypeSlug(entry: Pick<DictionaryEntry, 'kind' | 'key'>): string {
  return KIND_TO_SLUG[entry.kind ?? ''] ?? entry.kind ?? entry.key;
}

/** questionType master rows → Combobox options whose label is the display name and value the slug. */
export function toQuestionTypeOptions(entries: readonly DictionaryEntry[]): ComboboxOption[] {
  return entries.map((entry) => ({ value: questionTypeSlug(entry), label: entry.name }));
}
