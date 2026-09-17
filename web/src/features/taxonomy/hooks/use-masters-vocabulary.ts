import { useMemo } from 'react';
import type { DictionaryList } from '@ingest/contracts';
import { useDictionary } from './use-taxonomy.js';

/**
 * The curated dictionary names the cut-upload metadata Comboboxes suggest, so operators file every
 * chapter under the SAME managed vocabulary the extractor and publisher resolve against. Content
 * dimensions only — question type stays on its extraction tokens (they key the type-specific rules).
 */
export type MastersVocabulary = {
  exams: string[];
  subjects: string[];
  chapters: string[];
  sections: string[];
};

const names = (list: DictionaryList | undefined): string[] => list?.entries.map((entry) => entry.name) ?? [];

/** Load the four operator-chosen taxonomy dictionaries as flat name lists for the cut-upload pickers. */
export function useMastersVocabulary(): MastersVocabulary {
  const exam = useDictionary('exam', {});
  const subject = useDictionary('subject', {});
  const chapter = useDictionary('chapter', {});
  const section = useDictionary('section', {});
  return useMemo(
    () => ({
      exams: names(exam.data),
      subjects: names(subject.data),
      chapters: names(chapter.data),
      sections: names(section.data),
    }),
    [exam.data, subject.data, chapter.data, section.data],
  );
}
