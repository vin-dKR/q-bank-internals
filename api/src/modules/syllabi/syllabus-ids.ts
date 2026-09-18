import type { Syllabus, SyllabusFile, SyllabusSource, SyllabusSummary } from '@ingest/contracts';

function twoDigits(position: number): string {
  return String(position + 1).padStart(2, '0');
}

/**
 * Give an authored syllabus the ids the AI answers with. They come from position ("C07", "C07-T03") and only
 * have to be unique within one subject, because the model is never shown more than one subject at a time —
 * so an id is never stored anywhere and re-ordering a file is safe.
 */
export function resolveSyllabus(file: SyllabusFile, source: SyllabusSource, updatedAt: string | null): Syllabus {
  return {
    exam: file.exam,
    title: file.title,
    aliases: file.aliases,
    source,
    updatedAt,
    subjects: file.subjects.map((subject) => ({
      subject: subject.subject,
      aliases: subject.aliases,
      chapters: subject.chapters.map((chapter, chapterIndex) => {
        const id = `C${twoDigits(chapterIndex)}`;
        return {
          id,
          chapter: chapter.chapter,
          class: chapter.class,
          aliases: chapter.aliases,
          topics: chapter.topics.map((topic, topicIndex) => ({ id: `${id}-T${twoDigits(topicIndex)}`, topic })),
        };
      }),
    })),
  };
}

/** One syllabus reduced to the row the list screen shows. */
export function summarise(syllabus: Syllabus): SyllabusSummary {
  const chapters = syllabus.subjects.flatMap((subject) => subject.chapters);
  return {
    exam: syllabus.exam,
    title: syllabus.title,
    aliases: syllabus.aliases,
    source: syllabus.source,
    updatedAt: syllabus.updatedAt,
    subjects: syllabus.subjects.length,
    chapters: chapters.length,
    topics: chapters.reduce((total, chapter) => total + chapter.topics.length, 0),
  };
}
