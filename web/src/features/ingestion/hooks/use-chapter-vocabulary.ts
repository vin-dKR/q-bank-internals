import { useMemo } from 'react';
import { KNOWN_SOURCES } from '@ingest/contracts';
import type { ComboboxOption } from '../../../shared/ui/index.js';
import { toQuestionTypeOptions, useDictionary } from '../../taxonomy/index.js';

/**
 * The masters-backed suggestion lists that seed every metadata Combobox in the ingestion flow, plus the
 * dependent lookups (`subjectsFor`, `chaptersFor`, `sectionsFor`) that scope a child
 * field to the parent already chosen. Values normally come from the all-masters dictionaries; the two
 * supported behavioral profiles `true_false` and `fill_blank` remain selectable even though the
 * legacy bank master folds them into Subjective. That keeps an operator's type aligned with the
 * extractor without changing the publisher's existing bank mapping.
 *
 * `questionTypes` carries a value/label pair: the label is normally the master's display name (e.g.
 * "Matrix Match"), while those two profile-only choices have explicit labels. The value is the behavior
 * SLUG (e.g. `matrix`) the extraction TYPE_RULES key on. Every other list is plain names — publish folds
 * a chosen name to its dictionary FK, and the name is also the Drive folder segment. `sources` is a fixed
 * behavioral enum (it drives the PYQ pipeline), not a dictionary.
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
  chaptersFor: (subject: string) => string[];
  sectionsFor: (module: string) => string[];
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
 * place). Modules are independent provider names; Chapters are subject-scoped; Sections are filed
 * under Modules. Exam↔Subject links are optional many-to-many suggestions rather than a hierarchy.
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
    const examEntries = exam.data?.entries ?? [];
    const moduleEntries = moduleDict.data?.entries ?? [];
    const chapterEntries = chapter.data?.entries ?? [];
    const sectionEntries = section.data?.entries ?? [];

    // Entries arrive sorted by name from the API, so the flat lists are display-ready as-is.
    const exams = examEntries.map((entry) => entry.name);
    const subjects = subjectEntries.map((entry) => entry.name);
    const modules = moduleEntries.map((entry) => entry.name);
    const chapters = chapterEntries.map((entry) => entry.name);
    const sections = sectionEntries.map((entry) => entry.name);
    const questionTypes: ComboboxOption[] = toQuestionTypeOptions(questionType.data?.entries ?? []);

    // Name → id lookup and parent-scoped child lists. Modules are intentionally not linked to a
    // subject or exam: they identify independent providers such as Allen or PW.
    const examIdByName = new Map(
      examEntries.map((entry) => [entry.name.trim().toLowerCase(), entry.id]),
    );
    const subjectIdByName = new Map(
      subjectEntries.map((entry) => [entry.name.trim().toLowerCase(), entry.id]),
    );
    const moduleIdByName = new Map(
      moduleEntries.map((entry) => [entry.name.trim().toLowerCase(), entry.id]),
    );
    const chaptersBySubjectId = new Map<string, string[]>();
    const sectionsByModuleId = new Map<string, string[]>();
    for (const entry of chapterEntries) push(chaptersBySubjectId, entry.subjectId, entry.name);
    for (const entry of sectionEntries) push(sectionsByModuleId, entry.moduleId, entry.name);

    // Children scoped to the chosen subject; the full list when the subject is blank/unknown or has no
    // recorded children yet — so the field always offers managed values and is never dead.
    const forSubject = (
      relation: Map<string, string[]>,
      subjectName: string,
      fallback: string[],
    ): string[] => {
      const trimmed = subjectName.trim();
      if (!trimmed) return fallback;
      const id = subjectIdByName.get(trimmed.toLowerCase());
      if (!id) return fallback;
      const list = relation.get(id);
      return list && list.length > 0 ? list : fallback;
    };

    const forModule = (moduleName: string): string[] => {
      const id = moduleIdByName.get(moduleName.trim().toLowerCase());
      if (!id) return sections;
      // Old Sections have no moduleId. Keep them visible as global fallback while newly curated rows
      // appear only for their provider. If no row has been curated for this module yet, retain the
      // full legacy list so a freshly-added Module never produces a dead selector.
      const scoped = sectionsByModuleId.get(id) ?? [];
      const legacy = sectionEntries
        .filter((entry) => entry.moduleId === null)
        .map((entry) => entry.name);
      const visible = [...new Set([...scoped, ...legacy])];
      return visible.length > 0 ? visible : sections;
    };

    const subjectsForExam = (examName: string): string[] => {
      const id = examIdByName.get(examName.trim().toLowerCase());
      if (!id) return subjects;
      // An empty examIds array explicitly means a global subject. A subject can link to several
      // exams, and an exam with no configured links still shows the full dictionary rather than
      // forcing an operator to define every relationship before ingesting.
      const compatible = subjectEntries
        .filter((entry) => entry.examIds.length === 0 || entry.examIds.includes(id))
        .map((entry) => entry.name);
      return compatible.length > 0 ? compatible : subjects;
    };

    return {
      sources: [...KNOWN_SOURCES],
      exams,
      subjects,
      modules,
      chapters,
      sections,
      questionTypes,
      subjectsFor: subjectsForExam,
      chaptersFor: (subjectName) => forSubject(chaptersBySubjectId, subjectName, chapters),
      sectionsFor: forModule,
    };
  }, [exam.data, subject.data, moduleDict.data, chapter.data, section.data, questionType.data]);
}
