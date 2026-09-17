import { type JSX, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Passage, Question } from '@ingest/contracts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconChevronLeft,
  IconCopy,
  IconFileText,
  IconGrid,
  IconLayers,
  IconList,
  LoadingState,
  PageHeader,
  PassageView,
  QuestionView,
  type PassageViewModel,
  type QuestionViewModel,
  useToast,
} from '../../../shared/ui/index.js';
import { usePassages, useQuestions } from '../hooks/use-questions.js';

/** The three lenses on a document's extracted data. */
type ViewMode = 'rendered' | 'table' | 'json';
const VIEW_MODES: readonly { mode: ViewMode; label: string; icon: JSX.Element }[] = [
  { mode: 'rendered', label: 'Rendered', icon: <IconGrid /> },
  { mode: 'table', label: 'Table', icon: <IconList /> },
  { mode: 'json', label: 'JSON', icon: <IconFileText /> },
];

/** Comma-packed image field → individual URLs (question figures are stored this way). */
function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((url) => url.trim()).filter(Boolean) : [];
}

/** Map an ingest question into the shared read model, so Rendered uses the SAME renderer as the catalog. */
function toView(question: Question): QuestionViewModel {
  return {
    number: question.questionNumber,
    type: question.questionType,
    stem: question.stem,
    questionImages: question.isQuestionImage ? splitUrls(question.questionImage) : [],
    options: question.options.map((option, index) => ({
      label: option.label,
      body: option.body,
      isCorrect: option.isCorrect,
      image: question.isOptionImage ? question.optionImages[index] ?? null : null,
    })),
    match: question.match ? { columns: question.match.columns, key: question.match.key } : null,
    answer: question.answer || null,
    explanation: question.explanation,
    explanationImages: question.explanationImages,
  };
}

/** The shared comprehension passage of a group, as the read model wants it. */
function toPassageView(passage: Passage): PassageViewModel {
  return { text: passage.text, images: passage.passageImage ? [passage.passageImage] : [] };
}

/** The extra taxonomy/provenance pills a question carries beyond its type — the fields Rendered surfaces. */
function metaBadges(question: Question): JSX.Element {
  const chips: JSX.Element[] = [];
  if (question.level) chips.push(<Badge key="level" tone="neutral" dot={false}>{question.level}</Badge>);
  const section = question.sectionName ?? question.path.section;
  if (section) chips.push(<Badge key="section" tone="neutral" dot={false}>{section}</Badge>);
  if (question.topic) chips.push(<Badge key="topic" tone="neutral" dot={false}>{question.topic}</Badge>);
  const subject = question.subject;
  if (subject) chips.push(<Badge key="subject" tone="info" dot={false}>{subject}</Badge>);
  if (question.isPyq) {
    const pyq = [question.pyqExam, question.pyqYear].filter(Boolean).join(' ');
    chips.push(<Badge key="pyq" tone="info" dot={false}>PYQ{pyq ? ` · ${pyq}` : ''}</Badge>);
  }
  if (question.flagged) chips.push(<Badge key="flag" tone="review" dot={false}>Flagged</Badge>);
  return <>{chips}</>;
}

/** A cell value that is empty renders as a muted dash, so a blank never reads as a layout gap. */
function cell(value: string | null): JSX.Element {
  return value && value.trim() ? <>{value}</> : <span className="text-ink-3">—</span>;
}

/**
 * The full extracted-data viewer for one document — the page behind the "Data" action. Shows every
 * question three ways: RENDERED (the canonical read renderer, how the question actually looks), TABLE
 * (one scannable row of the key fields per question), and JSON (the complete raw record, copyable),
 * so an operator can inspect or share exactly what was extracted before it publishes.
 */
export function DocumentDataViewer({ documentId }: { documentId: string }): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const questions = useQuestions(documentId);
  const passages = usePassages(documentId);
  const [mode, setMode] = useState<ViewMode>('rendered');

  const rows = questions.data ?? [];
  const passageById = new Map((passages.data ?? []).map((passage) => [passage.id, passage] as const));

  // The COMPLETE raw record: the question verbatim, with its shared passage inlined (it lives on a
  // separate row) so nothing referenced by the question is hidden from the JSON view.
  const records = rows.map((question) => ({
    ...question,
    ...(question.passageId !== null ? { passage: passageById.get(question.passageId) ?? null } : {}),
  }));
  const json = JSON.stringify(records, null, 2);

  const unit = rows[0] ? [rows[0].path.module, rows[0].path.chapter].filter(Boolean).join(' › ') : '';
  const subtitle = rows.length > 0
    ? `${unit ? `${unit} · ` : ''}${String(rows.length)} question${rows.length === 1 ? '' : 's'}`
    : 'The extracted questions for this document, rendered, tabulated, and as raw JSON.';

  const copyJson = (): void => {
    void navigator.clipboard.writeText(json);
    toast.toast({ tone: 'success', title: 'Copied', description: `${String(records.length)} question record(s) copied as JSON.` });
  };

  return (
    <>
      <PageHeader
        title="Question data"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="ghost" onClick={() => { void navigate(-1); }}><IconChevronLeft /> Back</Button>
            <Button variant="primary" onClick={copyJson} disabled={records.length === 0}>
              <IconCopy /> Copy JSON
            </Button>
          </>
        }
      />

      <div className="segmented self-start" role="tablist" aria-label="Data view">
        {VIEW_MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="tab"
            aria-selected={mode === option.mode}
            className={`segmented__item ${mode === option.mode ? 'is-active' : ''}`}
            onClick={() => { setMode(option.mode); }}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>

      {questions.isPending ? (
        <Card><LoadingState label="Loading extracted questions…" /></Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconLayers />}
            title="No extracted questions yet"
            body="Run extraction on this document first — its questions will then show here."
          />
        </Card>
      ) : mode === 'json' ? (
        <Card>
          <pre className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
            {json}
          </pre>
        </Card>
      ) : mode === 'table' ? (
        <Card>
          <div className="table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Type</th>
                  <th>Level</th>
                  <th>Section</th>
                  <th>Topic</th>
                  <th>Subject</th>
                  <th>Answer</th>
                  <th className="num">Opts</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((question, index) => (
                  <tr key={question.id}>
                    <td className="num">{question.questionNumber ?? index + 1}</td>
                    <td>{cell(question.questionType)}</td>
                    <td>{cell(question.level)}</td>
                    <td>{cell(question.sectionName ?? question.path.section)}</td>
                    <td>{cell(question.topic)}</td>
                    <td>{cell(question.subject)}</td>
                    <td><span className="block max-w-[220px] truncate">{cell(question.answer || null)}</span></td>
                    <td className="num">{question.options.length}</td>
                    <td>
                      <span className="inline-flex flex-wrap gap-1">
                        {question.match ? <Badge tone="neutral" dot={false}>matrix</Badge> : null}
                        {question.passageId ? <Badge tone="neutral" dot={false}>group</Badge> : null}
                        {question.isPyq ? <Badge tone="info" dot={false}>PYQ</Badge> : null}
                        {question.flagged ? <Badge tone="review" dot={false}>flag</Badge> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((question, index) => {
            const passage = question.passageId !== null ? passageById.get(question.passageId) ?? null : null;
            // A group's shared passage is shown once, above its first sub-question.
            const isGroupHead =
              question.passageId !== null &&
              rows.findIndex((r) => r.passageId === question.passageId) === index;
            return (
              <div key={question.id} className="flex flex-col gap-3">
                {isGroupHead && passage ? (
                  <Card><PassageView passage={toPassageView(passage)} /></Card>
                ) : null}
                <QuestionView model={toView(question)} badges={metaBadges(question)} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
