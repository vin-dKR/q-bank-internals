import { useMemo } from 'react';
import { KNOWN_EXAMS, KNOWN_MODULES, KNOWN_QUESTION_TYPES, KNOWN_SOURCES } from '@ingest/contracts';
import { useDocuments } from '../../documents/index.js';
import { useDriveVocabulary } from '../../drive-folders/index.js';
import { useSessions } from '../../sessions/index.js';

/**
 * The known-value suggestion lists that seed every metadata Combobox in the ingestion flow, plus the
 * dependent lookups (`subjectsFor`, `modulesFor`, `chaptersFor`, `sectionsFor`) that scope a child
 * field to the parent already chosen — so the chapter list shows only that module's chapters instead
 * of every chapter that exists. Each lookup falls back to the full flat list when its parent is empty
 * or unknown, so no field is ever dead and a brand-new value can still be typed.
 */
export type ChapterVocabulary = {
  sources: string[];
  exams: string[];
  subjects: string[];
  modules: string[];
  chapters: string[];
  sections: string[];
  questionTypes: string[];
  subjectsFor: (exam: string) => string[];
  modulesFor: (subject: string) => string[];
  chaptersFor: (module: string) => string[];
  sectionsFor: (module: string, chapter: string) => string[];
};

function distinct(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Compose a module+chapter into one unambiguous key for the section lookup (JSON avoids collisions). */
function unitKey(module: string, chapter: string): string {
  return JSON.stringify([module.trim(), chapter.trim()]);
}

/** Record one parent→child edge, ignoring blanks, in a name-keyed relation being accumulated. */
function link(relation: Map<string, Set<string>>, parent: string | null | undefined, child: string | null | undefined): void {
  const p = parent?.trim();
  const c = child?.trim();
  if (!p || !c) return;
  let set = relation.get(p);
  if (!set) {
    set = new Set();
    relation.set(p, set);
  }
  set.add(c);
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

    // Parent→child relations, merged from every source that carries the linkage: the Drive tree
    // (exam→subject→module→chapter), sessions (exam→subject→module), and registered documents
    // (module→chapter→section, via each document's source path).
    const subjectsByExam = new Map<string, Set<string>>();
    const modulesBySubject = new Map<string, Set<string>>();
    const chaptersByModule = new Map<string, Set<string>>();
    const sectionsByUnit = new Map<string, Set<string>>();

    for (const [exam, subjects] of Object.entries(drive?.subjectsByExam ?? {})) {
      for (const subject of subjects) link(subjectsByExam, exam, subject);
    }
    for (const [subject, modules] of Object.entries(drive?.modulesBySubject ?? {})) {
      for (const module of modules) link(modulesBySubject, subject, module);
    }
    for (const [module, chapters] of Object.entries(drive?.chaptersByModule ?? {})) {
      for (const chapter of chapters) link(chaptersByModule, module, chapter);
    }
    for (const s of sess) {
      link(subjectsByExam, s.exam, s.subject);
      link(modulesBySubject, s.subject, s.module);
    }
    for (const d of docs) {
      link(chaptersByModule, d.path.module, d.path.chapter);
      const unit = unitKey(d.path.module, d.path.chapter);
      link(sectionsByUnit, unit, d.path.section);
      link(sectionsByUnit, unit, d.sectionName);
    }

    const sources = distinct([...KNOWN_SOURCES, ...docs.map((d) => d.source)]);
    const exams = distinct([...KNOWN_EXAMS, ...sess.map((s) => s.exam), ...(drive?.exams ?? [])]);
    const subjects = distinct([...sess.map((s) => s.subject), ...(drive?.subjects ?? [])]);
    const modules = distinct([
      ...KNOWN_MODULES,
      ...sess.map((s) => s.module),
      ...docs.map((d) => d.path.module),
      ...(drive?.modules ?? []),
    ]);
    const chapters = distinct([...docs.map((d) => d.path.chapter), ...(drive?.chapters ?? [])]);
    const sections = distinct([...docs.map((d) => d.path.section), ...docs.map((d) => d.sectionName)]);
    const questionTypes = distinct([...KNOWN_QUESTION_TYPES, ...docs.map((d) => d.questionType)]);

    // Children scoped to a chosen parent; the full list when the parent is blank or has no recorded
    // children (unknown/custom), so the field still suggests something and never blocks a new value.
    const scoped = (relation: Map<string, Set<string>>, key: string, fallback: string[]): string[] => {
      const trimmed = key.trim();
      if (!trimmed) return fallback;
      const set = relation.get(trimmed);
      return set ? [...set].sort((a, b) => a.localeCompare(b)) : fallback;
    };

    return {
      sources,
      exams,
      subjects,
      modules,
      chapters,
      sections,
      questionTypes,
      subjectsFor: (exam) => scoped(subjectsByExam, exam, subjects),
      modulesFor: (subject) => scoped(modulesBySubject, subject, modules),
      chaptersFor: (module) => scoped(chaptersByModule, module, chapters),
      sectionsFor: (module, chapter) => scoped(sectionsByUnit, unitKey(module, chapter), sections),
    };
  }, [documents.data, sessions.data, driveVocabulary.data]);
}
