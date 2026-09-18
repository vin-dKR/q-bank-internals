import { useMemo } from 'react';
import { KNOWN_SOURCES } from '@ingest/contracts';
import type { ComboboxOption } from '../../../shared/ui/index.js';
import { toQuestionTypeOptions, useDictionary } from '../../taxonomy/index.js';

/**
 * The masters-backed suggestion lists that seed every metadata Combobox in the ingestion flow, plus the
 * dependent lookups (`subjectsFor`, `modulesFor`, `chaptersFor`, `sectionsFor`) that scope a child
 * field to the parent already chosen. Every value comes from the all-masters dictionaries only — never
 * the Drive tree, past documents/sessions, or hardcoded constants — so an operator can only file a
 * chapter under managed vocabulary the extractor and publisher already resolve against.
 *
 * `questionTypes` carries a value/label pair: the label is the master's display name (e.g. "Matrix
 * Match"), the value is the behavior SLUG (e.g. `matrix`) the extraction TYPE_RULES key on. Every other
 * list is plain names — publish folds a chosen name to its dictionary FK, and the name is also the Drive
 * folder segment. `sources` is a fixed behavioral enum (it drives the PYQ pipeline), not a dictionary.
 */
export type ChapterVocabulary = {
  sources: string[];
  exams: string[];
  subjects: string[];
  modules: string[];
  chapters: string[];
  sections: string[];
  questionTypes: ComboboxOption[];
  subjectsFor: (exam: string) => string[];
  modulesFor: (subject: string) => string[];
  chaptersFor: (subject: string) => string[];
  sectionsFor: (module: string, chapter: string) => string[];
};

/** Accumulate a parent-id → child-name edge, ignoring blanks. */
function push(relation: Map<string, string[]>, key: string | null, child: string): void {
  if (!key) return;
  const list = relation.get(key);
  if (list) list.push(child);
  else relation.set(key, [child]);
}

/**
 * The single source of Combobox suggestions for chapter metadata — every list read from the all-masters
 * dictionaries (with ids, so the dependent cascade can scope children to the chosen subject). Extracted
 * so the chapter form and the structure-tree builder offer identical managed values (one concept, one
 * place). Chapters and modules are subject-scoped in masters; exam/subject/section are global lists.
 */
export function useChapterVocabulary(): ChapterVocabulary {
  const exam = useDictionary('exam', {});
  const subject = useDictionary('subject', {});
  const moduleDict = useDictionary('module', {});
  const chapter = useDictionary('chapter', {});
  const section = useDictionary('section', {});
  const questionType = useDictionary('questionType', {});

  return useMemo(() => {
    const subjectEntries = subject.data?.entries ?? [];
    const moduleEntries = moduleDict.data?.entries ?? [];
    const chapterEntries = chapter.data?.entries ?? [];

    // Entries arrive sorted by name from the API, so the flat lists are display-ready as-is.
    const exams = (exam.data?.entries ?? []).map((entry) => entry.name);
    const subjects = subjectEntries.map((entry) => entry.name);
    const modules = moduleEntries.map((entry) => entry.name);
    const chapters = chapterEntries.map((entry) => entry.name);
    const sections = (section.data?.entries ?? []).map((entry) => entry.name);
    const questionTypes: ComboboxOption[] = toQuestionTypeOptions(questionType.data?.entries ?? []);

    // Subject name → id, and the subject-scoped child lists, so picking a subject narrows its modules
    // and chapters (the only parent link masters encodes for these dimensions).
    const subjectIdByName = new Map(subjectEntries.map((entry) => [entry.name.trim().toLowerCase(), entry.id]));
    const modulesBySubjectId = new Map<string, string[]>();
    const chaptersBySubjectId = new Map<string, string[]>();
    for (const entry of moduleEntries) push(modulesBySubjectId, entry.subjectId, entry.name);
    for (const entry of chapterEntries) push(chaptersBySubjectId, entry.subjectId, entry.name);

    // Children scoped to the chosen subject; the full list when the subject is blank/unknown or has no
    // recorded children yet — so the field always offers managed values and is never dead.
    const forSubject = (relation: Map<string, string[]>, subjectName: string, fallback: string[]): string[] => {
      const trimmed = subjectName.trim();
      if (!trimmed) return fallback;
      const id = subjectIdByName.get(trimmed.toLowerCase());
      if (!id) return fallback;
      const list = relation.get(id);
      return list && list.length > 0 ? list : fallback;
    };

    return {
      sources: [...KNOWN_SOURCES],
      exams,
      subjects,
      modules,
      chapters,
      sections,
      questionTypes,
      // Subjects are global taxonomy (Physics is Physics across exams), so exam does not narrow them.
      subjectsFor: () => subjects,
      modulesFor: (subjectName) => forSubject(modulesBySubjectId, subjectName, modules),
      chaptersFor: (subjectName) => forSubject(chaptersBySubjectId, subjectName, chapters),
      // Sections are global exercise/section labels (Exercise-1, PYQ …), shared across chapters.
      sectionsFor: () => sections,
    };
  }, [exam.data, subject.data, moduleDict.data, chapter.data, section.data, questionType.data]);
}
