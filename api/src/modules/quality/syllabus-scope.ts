import type { Syllabus, SyllabusChapter, SyllabusSubject } from '@ingest/contracts';
import { isCalled, nameKey } from '../syllabi/index.js';
import type { TopicOption } from './quality.repository.js';
import type { AuditQuestion } from './quality.types.js';

/**
 * Where a question's topic may be chosen from. `blocked` means it cannot be matched at all until a person
 * fixes the question's metadata (or a syllabus is uploaded for its exam) — guessing across exams is exactly
 * what this prevents. `ready` narrows to one exam and subject; `chapterMatched` says whether the stored
 * chapter already picked the chapters, or every chapter of the subject is still in play and one has to be
 * chosen first.
 */
export type TopicScope =
  | { status: 'blocked'; reason: string }
  | { status: 'ready'; exam: Syllabus; subject: SyllabusSubject; chapters: SyllabusChapter[]; chapterMatched: boolean };

/** Resolve a question's exam, then subject, then chapter against the loaded syllabi. */
export function resolveTopicScope(
  syllabi: readonly Syllabus[],
  question: Pick<AuditQuestion, 'exam' | 'subject' | 'chapter'>,
): TopicScope {
  const examKey = nameKey(question.exam ?? '');
  if (examKey === '') {
    return { status: 'blocked', reason: "The exam is not set. Set the exam first — a topic is only matched against its own exam's syllabus." };
  }
  const exam = syllabi.find((syllabus) => isCalled(examKey, syllabus.exam, syllabus.aliases));
  if (!exam) {
    return { status: 'blocked', reason: `No syllabus is loaded for the exam "${question.exam ?? ''}", so its topic cannot be matched.` };
  }

  const subjectKey = nameKey(question.subject ?? '');
  if (subjectKey === '') {
    return { status: 'blocked', reason: `The subject is not set. Set it first — a topic is matched within one ${exam.exam} subject.` };
  }
  const subject = exam.subjects.find((candidate) => isCalled(subjectKey, candidate.subject, candidate.aliases));
  if (!subject) {
    return { status: 'blocked', reason: `The ${exam.exam} syllabus has no subject "${question.subject ?? ''}".` };
  }

  const chapterKey = nameKey(question.chapter ?? '');
  const matched = chapterKey === '' ? [] : subject.chapters.filter((chapter) => isCalled(chapterKey, chapter.chapter, chapter.aliases));
  return matched.length > 0
    ? { status: 'ready', exam, subject, chapters: matched, chapterMatched: true }
    : { status: 'ready', exam, subject, chapters: subject.chapters, chapterMatched: false };
}

/** A chapter as shown to the model and the reviewer; the class tells apart the two NCERT "Probability" chapters. */
export function chapterLabel(chapter: SyllabusChapter): string {
  return chapter.class === null ? chapter.chapter : `${chapter.chapter} (Class ${String(chapter.class)})`;
}

/** The topics of some chapters as the choosable vocabulary. */
export function topicOptions(chapters: readonly SyllabusChapter[]): TopicOption[] {
  return chapters.flatMap((chapter) =>
    chapter.topics.map((topic) => ({ id: topic.id, topic: topic.topic, chapter: chapterLabel(chapter) })),
  );
}
