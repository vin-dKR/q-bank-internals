import { type JSX, useState } from 'react';
import type { SyllabusSummary } from '@ingest/contracts';
import { Badge, Button, Card, EmptyState, LoadingState, useConfirm } from '../../../shared/ui/index.js';
import { useDeleteSyllabus, useSyllabi, useSyllabus } from '../hooks/use-syllabi.js';
import { SyllabusTree } from './syllabus-tree.js';

function when(iso: string | null): string {
  return iso === null ? 'ships with the app' : `uploaded ${new Date(iso).toLocaleString()}`;
}

/** One exam: what it covers, where it came from, and its nested subjects → chapters → topics on demand. */
function ExamCard({ summary }: { summary: SyllabusSummary }): JSX.Element {
  const [open, setOpen] = useState(false);
  const detail = useSyllabus(summary.exam, open);
  const remove = useDeleteSyllabus();
  const [confirm, confirmDialog] = useConfirm();

  const drop = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Remove the uploaded ${summary.exam} syllabus?`,
      body: 'Questions of this exam cannot have their topics matched until a syllabus is uploaded again (or a bundled one takes over). Nothing already saved on a question changes.',
      confirmLabel: 'Remove it',
      tone: 'danger',
    });
    if (confirmed) remove.mutate(summary.exam);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-base font-semibold text-ink">{summary.exam}</h3>
            <Badge tone={summary.source === 'uploaded' ? 'info' : 'neutral'}>{summary.source}</Badge>
            <span className="text-xs text-ink-3">{when(summary.updatedAt)}</span>
          </div>
          <p className="m-0 text-sm text-ink-2">{summary.title}</p>
          <p className="m-0 text-sm text-ink-3">
            {summary.subjects} subject{summary.subjects === 1 ? '' : 's'} · {summary.chapters} chapters ·{' '}
            {summary.topics} topics
            {summary.aliases.length > 0 ? ` · also stored as: ${summary.aliases.join(', ')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={() => { setOpen(!open); }}>
            {open ? 'Hide topics' : 'View topics'}
          </Button>
          {summary.source === 'uploaded' ? (
            <Button variant="ghost" size="xs" disabled={remove.isPending} onClick={() => { void drop(); }}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {open ? <SyllabusTree syllabus={detail.data} loading={detail.isPending} /> : null}
      {confirmDialog}
    </Card>
  );
}

/** Every exam that has a syllabus, each one expandable down to its topics. */
export function SyllabusList(): JSX.Element {
  const { data, isPending, error } = useSyllabi();

  if (isPending) return <LoadingState label="Loading syllabi…" />;
  if (error) return <EmptyState title="Could not load the syllabi" body={error.message} />;
  if (data.syllabi.length === 0) {
    return (
      <EmptyState
        title="No exam has a syllabus yet"
        body="Upload one above. Until an exam has a syllabus, the AI cannot match its questions to topics — it reports them instead of guessing."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.syllabi.map((summary) => <ExamCard key={summary.exam} summary={summary} />)}
    </div>
  );
}
