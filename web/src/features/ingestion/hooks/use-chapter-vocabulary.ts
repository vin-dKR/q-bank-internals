import { useMemo } from 'react';
import { KNOWN_EXAMS, KNOWN_MODULES, KNOWN_QUESTION_TYPES } from '@ingest/contracts';
import { useDocuments } from '../../documents/index.js';
import { useDriveVocabulary } from '../../drive-folders/index.js';
import { useSessions } from '../../sessions/index.js';

/** The known-value suggestion lists that seed every metadata Combobox in the ingestion flow. */
export type ChapterVocabulary = {
  exams: string[];
  subjects: string[];
  modules: string[];
  chapters: string[];
  sections: string[];
  questionTypes: string[];
};

function distinct(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * The single source of Combobox suggestions for chapter metadata: known defaults + values already
 * used across existing documents/sessions + everything in the masters Drive tree. Extracted so the
 * chapter form and the structure-tree builder offer identical known values (one concept, one place).
 */
export function useChapterVocabulary(): ChapterVocabulary {
  const documents = useDocuments();
  const sessions = useSessions();
  const driveVocabulary = useDriveVocabulary();

  return useMemo(() => {
    const docs = documents.data?.items ?? [];
    const sess = sessions.data?.items ?? [];
    const drive = driveVocabulary.data;
    return {
      exams: distinct([...KNOWN_EXAMS, ...sess.map((s) => s.exam), ...(drive?.exams ?? [])]),
      subjects: distinct([...sess.map((s) => s.subject), ...(drive?.subjects ?? [])]),
      modules: distinct([
        ...KNOWN_MODULES,
        ...sess.map((s) => s.module),
        ...docs.map((d) => d.path.module),
        ...(drive?.modules ?? []),
      ]),
      chapters: distinct([...docs.map((d) => d.path.chapter), ...(drive?.chapters ?? [])]),
      sections: distinct([...docs.map((d) => d.path.section), ...docs.map((d) => d.sectionName)]),
      questionTypes: distinct([...KNOWN_QUESTION_TYPES, ...docs.map((d) => d.questionType)]),
    };
  }, [documents.data, sessions.data, driveVocabulary.data]);
}
