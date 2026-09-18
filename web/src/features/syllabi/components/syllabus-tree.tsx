import { type JSX, useState } from 'react';
import type { Syllabus, SyllabusChapter, SyllabusSubject } from '@ingest/contracts';
import { Badge, LoadingState } from '../../../shared/ui/index.js';

/** A chapter row that opens to its topics — the leaves the AI actually chooses between. */
function ChapterRow({ chapter }: { chapter: SyllabusChapter }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
        onClick={() => { setOpen(!open); }}
        aria-expanded={open}
      >
        <span className="w-3 text-ink-3">{open ? '−' : '+'}</span>
        <span className="font-medium text-ink">{chapter.chapter}</span>
        {chapter.class !== null ? <span className="text-xs text-ink-3">Class {chapter.class}</span> : null}
        <span className="text-xs text-ink-3">
          {chapter.topics.length} topic{chapter.topics.length === 1 ? '' : 's'}
        </span>
        {chapter.aliases.length > 0 ? (
          <span className="truncate text-xs text-ink-3">also filed as: {chapter.aliases.join(', ')}</span>
        ) : null}
      </button>
      {open ? (
        <ol className="m-0 flex list-none flex-col gap-1 bg-surface-2 px-3 py-2 pl-8 text-sm text-ink-2">
          {chapter.topics.map((topic) => (
            <li key={topic.id} className="flex gap-2">
              <code className="shrink-0 text-xs text-ink-3">{topic.id}</code>
              <span>{topic.topic}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function SubjectSection({ subject }: { subject: SyllabusSubject }): JSX.Element {
  const topics = subject.chapters.reduce((total, chapter) => total + chapter.topics.length, 0);
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 text-sm font-semibold text-ink">{subject.subject}</h4>
        <span className="text-xs text-ink-3">
          {subject.chapters.length} chapters · {topics} topics
        </span>
        {subject.aliases.length > 0 ? (
          <span className="text-xs text-ink-3">also called: {subject.aliases.join(', ')}</span>
        ) : null}
      </header>
      <ul className="m-0 flex list-none flex-col rounded-lg border border-line p-0">
        {subject.chapters.map((chapter) => <ChapterRow key={chapter.id} chapter={chapter} />)}
      </ul>
    </section>
  );
}

/**
 * One exam's syllabus as the nested vocabulary it is: subject → chapter → topics. This is exactly what the
 * AI is offered for a question of that exam, so what you read here is what it may choose from.
 */
export function SyllabusTree({ syllabus, loading }: { syllabus: Syllabus | undefined; loading: boolean }): JSX.Element {
  if (loading || !syllabus) return <LoadingState label="Loading the syllabus…" />;
  return (
    <div className="flex flex-col gap-4">
      {syllabus.subjects.length === 0 ? <Badge tone="danger">This syllabus has no subjects</Badge> : null}
      {syllabus.subjects.map((subject) => <SubjectSection key={subject.subject} subject={subject} />)}
    </div>
  );
}
