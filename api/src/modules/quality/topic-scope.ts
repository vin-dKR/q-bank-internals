import { canonicalizeMaster, type MasterDimension } from '../../shared/taxonomy/fold-maps.js';
import type { DictionaryRow } from '../masters/index.js';
import type { TopicOption } from './quality.repository.js';
import type { AuditQuestion } from './quality.types.js';

/** The three Masters → Question taxonomy dictionaries a topic is chosen from. */
export type TaxonomySnapshot = {
  subjects: readonly DictionaryRow[];
  chapters: readonly DictionaryRow[];
  topics: readonly DictionaryRow[];
};

/**
 * One chapter of the question's subject, with its topics. `id` is a short ordinal ("C3") the model answers
 * with — the Mongo ids behind the taxonomy are long, and a model copies a short id far more reliably.
 */
export type ScopeChapter = { id: string; chapter: string; topics: { id: string; topic: string }[] };

/**
 * Where a question's topic may be chosen from. `blocked` means it cannot be matched until a person fixes
 * the question's subject, or adds its chapters and topics in Question taxonomy. `ready` narrows to one
 * subject; `chapterMatched` says whether the stored chapter already picked the chapter, or every chapter of
 * the subject is still in play and one has to be chosen first.
 */
export type TopicScope =
  | { status: 'blocked'; reason: string }
  | { status: 'ready'; subject: string; chapters: ScopeChapter[]; chapterMatched: boolean };

/**
 * Whether a stored name refers to a dictionary row: its canonical key, or any alias folded the same way —
 * the exact match rule main's taxonomy resolver uses when it stamps the bank's ids at publish.
 */
function isCalled(dimension: MasterDimension, row: DictionaryRow, raw: string | null): boolean {
  const key = canonicalizeMaster(dimension, raw)?.key;
  if (key === undefined) return false;
  return row.key === key || row.aliases.some((alias) => canonicalizeMaster(dimension, alias)?.key === key);
}

/** Resolve a question's subject, then its chapter, against the taxonomy. Exam does not scope subjects there. */
export function resolveTopicScope(taxonomy: TaxonomySnapshot, question: Pick<AuditQuestion, 'subject' | 'chapter'>): TopicScope {
  if (question.subject === null || question.subject.trim() === '') {
    return { status: 'blocked', reason: 'The subject is not set. Set it first — a topic is chosen from its own subject\'s chapters.' };
  }
  const subject = taxonomy.subjects.find((row) => isCalled('subject', row, question.subject));
  if (!subject) {
    return { status: 'blocked', reason: `"${question.subject}" is not a subject in Masters → Question taxonomy, so its topic cannot be matched.` };
  }

  // Only chapters that actually have topics can yield one; numbered in taxonomy order so ids are stable per load.
  const chapterRows = taxonomy.chapters.filter((row) => row.subjectId === subject.id);
  const chapters = chapterRows
    .map((row) => ({ row, topics: taxonomy.topics.filter((topic) => topic.chapterId === row.id) }))
    .filter(({ topics }) => topics.length > 0)
    .map(({ row, topics }, index) => ({
      row,
      scoped: {
        id: `C${String(index + 1)}`,
        chapter: row.name,
        topics: topics.map((topic) => ({ id: topic.id, topic: topic.name })),
      },
    }));
  if (chapters.length === 0) {
    return {
      status: 'blocked',
      reason: `No chapter of ${subject.name} has topics in Masters → Question taxonomy yet. Add them there first.`,
    };
  }

  const matched = chapters.filter(({ row }) => isCalled('chapter', row, question.chapter));
  return matched.length > 0
    ? { status: 'ready', subject: subject.name, chapters: matched.map(({ scoped }) => scoped), chapterMatched: true }
    : { status: 'ready', subject: subject.name, chapters: chapters.map(({ scoped }) => scoped), chapterMatched: false };
}

/**
 * The topics of some chapters as the choosable vocabulary, numbered T1…Tn for the model. The number is only
 * the model's handle; what is saved is the topic's name, exactly as Question taxonomy spells it.
 */
export function topicOptions(chapters: readonly ScopeChapter[]): TopicOption[] {
  let next = 0;
  return chapters.flatMap((chapter) =>
    chapter.topics.map((topic) => {
      next += 1;
      return { id: `T${String(next)}`, topic: topic.topic, chapter: chapter.chapter };
    }),
  );
}
