import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AI_FIX_FIELDS,
  ANOMALY_KINDS,
  type AnomalyGroup,
  type AnomalyKind,
  KNOWN_QUESTION_TYPES,
  QUESTION_LEVELS,
  QuestionLevelSchema,
  type AiFillClaim,
  type AiFillTag,
  type AiFixField,
  type AiFixSuggestion,
  type Anomaly,
  type FixTarget,
  type QuestionFix,
  type QualitySummary,
} from '@ingest/contracts';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { refineLatex } from '../../../shared/api/refine.js';
import {
  Button,
  EmptyState,
  IconCheck,
  IconCopy,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconWarning,
  LoadingState,
  Spinner,
  buttonClasses,
  useToast,
} from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { formatDateTime } from '../lib/anomaly-display.js';
import { planForQuestion } from '../lib/rule-fields.js';

/** The editable fields, in the order the panel shows them. */
type Draft = {
  topic: string;
  subject: string;
  chapter: string;
  exam: string;
  questionType: string;
  sectionName: string;
  level: string;
  questionText: string;
  options: string[];
  answer: string;
  explanation: string;
};

/** Which draft field each anomaly's bank column belongs to, so the offending input can be highlighted. */
const FIELD_OF_COLUMN: Record<string, keyof Draft> = {
  topic: 'topic',
  subject: 'subject',
  chapter: 'chapter',
  exam_name: 'exam',
  question_type: 'questionType',
  section_name: 'sectionName',
  question_text: 'questionText',
  options: 'options',
  answer: 'answer',
  explanation: 'explanation',
  level: 'level',
};

function fieldOf(anomaly: Anomaly): keyof Draft | null {
  if (anomaly.field === null) return null;
  const column = anomaly.field.replace(/\[\d+\].*$/, '');
  return FIELD_OF_COLUMN[column] ?? null;
}

function toDraft(target: FixTarget): Draft {
  return {
    topic: target.topic ?? '',
    subject: target.subject ?? '',
    chapter: target.chapter ?? '',
    exam: target.exam ?? '',
    questionType: target.questionType ?? '',
    sectionName: target.sectionName ?? '',
    level: target.level ?? '',
    questionText: target.questionText,
    options: target.options,
    answer: target.answer ?? '',
    explanation: target.explanation ?? '',
  };
}

/** Only the fields the operator actually changed, as the API's patch shape (empty text clears a field). */
function toFix(draft: Draft, target: FixTarget): QuestionFix {
  const original = toDraft(target);
  const fix: QuestionFix = {};
  if (draft.topic !== original.topic) fix.topic = draft.topic.trim() || null;
  if (draft.subject !== original.subject) fix.subject = draft.subject.trim() || null;
  if (draft.chapter !== original.chapter) fix.chapter = draft.chapter.trim() || null;
  if (draft.exam !== original.exam) fix.exam = draft.exam.trim() || null;
  if (draft.questionType !== original.questionType) fix.questionType = draft.questionType.trim() || null;
  if (draft.sectionName !== original.sectionName) fix.sectionName = draft.sectionName.trim() || null;
  if (draft.level !== original.level) fix.level = QuestionLevelSchema.safeParse(draft.level).data ?? null;
  if (draft.questionText !== original.questionText) fix.questionText = draft.questionText;
  if (draft.answer !== original.answer) fix.answer = draft.answer.trim() || null;
  if (draft.explanation !== original.explanation) fix.explanation = draft.explanation.trim() || null;
  const optionsChanged =
    draft.options.length !== original.options.length ||
    draft.options.some((option, index) => option !== original.options[index]);
  if (optionsChanged) fix.options = draft.options;
  return fix;
}

/**
 * The fields this panel can ask the AI for. Structure (a lost match table or passage) is missing: rebuilding
 * it is reviewed as a table on the Fix with AI screen, not typed into these boxes.
 */
const PANEL_AI_FIELDS = AI_FIX_FIELDS.filter((field): field is PanelAiField => field !== 'structure');
type PanelAiField = Exclude<AiFixField, 'structure'>;

/** The draft value of each AI-fillable field, as {@link toFix} would save it. */
function aiDraftValue(draft: Draft, field: PanelAiField): string | null {
  switch (field) {
    case 'topic':
      return draft.topic.trim() || null;
    case 'answer':
      return draft.answer.trim() || null;
    case 'solution':
      return draft.explanation.trim() || null;
    case 'level':
      return QuestionLevelSchema.safeParse(draft.level).data ?? null;
  }
}

/** What the AI suggested for a field, trimmed the way a save trims it; null when it decided nothing. */
function suggestedValue(suggestion: AiFixSuggestion, field: PanelAiField): string | null {
  const value = suggestion[field];
  return value === null ? null : value.trim() || null;
}

/**
 * The fields this save writes with exactly the value the AI suggested — the ones the server tags as
 * AI-filled. A suggestion the operator then edited is theirs, so it is not claimed.
 */
function aiClaim(draft: Draft, fix: QuestionFix, suggestion: AiFixSuggestion | null): AiFillClaim | undefined {
  if (!suggestion) return undefined;
  const written: Record<PanelAiField, boolean> = {
    topic: fix.topic !== undefined,
    answer: fix.answer !== undefined,
    solution: fix.explanation !== undefined,
    level: fix.level !== undefined,
  };
  const fields = PANEL_AI_FIELDS.filter((field) => {
    const suggested = suggestedValue(suggestion, field);
    return written[field] && suggested !== null && aiDraftValue(draft, field) === suggested;
  });
  return fields.length > 0 ? { fields, model: suggestion.model, confidence: suggestion.confidence } : undefined;
}

/** The badge beside a field holding AI-written data: already saved as such, or about to be. */
type AiMark = { pending: boolean; title: string };

function describeTag(tag: AiFillTag): string {
  const how = tag.via === 'review' ? 'approved on the Fix with AI review' : 'saved from an AI suggestion';
  return `Filled by AI — ${tag.model}, ${String(Math.round(tag.confidence * 100))}% confident, ${how} ${formatDateTime(tag.at)}`;
}

function AiBadge({ mark }: { mark: AiMark | null }): JSX.Element | null {
  if (mark === null) return null;
  return (
    <span
      title={mark.title}
      className={cn(
        'ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-px align-middle text-[10px] font-medium uppercase tracking-wide text-ink-3 [&>svg]:size-3',
        mark.pending ? 'border border-dashed border-line-strong' : 'bg-surface-2',
      )}
    >
      <IconSparkle /> AI{mark.pending ? ' · on save' : ''}
    </span>
  );
}

const INPUT = 'w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft';

/** The caption above a field, turning red when an open anomaly points at it. */
function FieldLabel({ label, flagged, ai = null }: { label: string; flagged: boolean; ai?: AiMark | null }): JSX.Element {
  return (
    <span className={cn('text-xs font-medium', flagged ? 'text-bad' : 'text-ink-2')}>
      {label}{flagged ? ' — needs fixing' : ''}
      <AiBadge mark={ai} />
    </span>
  );
}

/**
 * Wrapper that marks a flagged LaTeX field. The field itself is the app's one editable LaTeX control:
 * rendered at rest, raw source on click — so a question is never shown twice, once to read and once to edit.
 */
function Editable({ flagged, children }: { flagged: boolean; children: JSX.Element }): JSX.Element {
  return <div className={cn('rounded-lg', flagged && 'ring-1 ring-line-strong')}>{children}</div>;
}

/** One labelled input; `flagged` marks a field an open anomaly points at. */
function Field({
  label,
  value,
  flagged,
  list,
  ai = null,
  onChange,
}: {
  label: string;
  value: string;
  flagged: boolean;
  ai?: AiMark | null;
  /** A `<datalist>` id whose values this field suggests while typing. */
  list?: string | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel label={label} flagged={flagged} ai={ai} />
      <input
        type="text"
        value={value}
        list={list}
        onChange={(event) => { onChange(event.target.value); }}
        className={cn(INPUT, 'border-line')}
      />
    </label>
  );
}

const AI_FIELD_LABELS: Record<PanelAiField, string> = {
  topic: 'Topic',
  answer: 'Answer',
  solution: 'Solution',
  level: 'Level',
};

/**
 * The AI section: choose what the model should work out, run it, and see what came back. The suggestion
 * only fills the form — the operator still presses Save — so a wrong answer can never reach the bank on
 * its own, and the confidence and notes are shown next to it to judge by.
 */
function AiFixBar({
  selected,
  suggestion,
  questionType,
  reason,
  busy,
  refining,
  onToggle,
  onRun,
  onRunWithType,
  onRefine,
}: {
  selected: Set<PanelAiField>;
  suggestion: AiFixSuggestion | null;
  /** Why these boxes are ticked — shown until a suggestion replaces it with what came back. */
  reason: string;
  /** The question's stored type, named in the "ask again" button. */
  questionType: string | null;
  busy: boolean;
  refining: boolean;
  onToggle: (field: PanelAiField) => void;
  onRun: () => void;
  /** Re-run with the stored type confirmed, so the answer must fit it. */
  onRunWithType: () => void;
  onRefine: () => void;
}): JSX.Element {
  // Every requested field came back null — the run cost tokens and changed nothing, which the operator
  // must see rather than infer from an unchanged form.
  const filledNothing =
    suggestion !== null &&
    suggestion.topic === null &&
    suggestion.answer === null &&
    suggestion.solution === null &&
    suggestion.level === null;

  return (
    <details className="rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-brand-soft [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-medium text-ink"><IconSparkle /> AI assistance</span>
        <span className="text-xs text-ink-3">{suggestion ? 'Suggestion ready · review before saving' : 'Optional'}</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
        <p className="m-0 text-xs text-ink-2">
          Choose the fields to suggest. Nothing is saved until you review the values and press Save.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {PANEL_AI_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-2">
              <input
                type="checkbox"
                className="size-4 w-auto accent-ink"
                checked={selected.has(field)}
                disabled={busy}
                onChange={() => { onToggle(field); }}
              />
              {AI_FIELD_LABELS[field]}
            </label>
          ))}
          <Button
            size="xs"
            disabled={busy || selected.size === 0}
            title={selected.size === 0 ? 'Select a field for the AI to work out' : undefined}
            onClick={onRun}
          >
            {busy ? <Spinner /> : <IconSparkle />}
            {busy ? 'Working…' : `Suggest ${String(selected.size)} field${selected.size === 1 ? '' : 's'}`}
          </Button>
          <Button
            size="xs"
            disabled={refining}
            title="Wrap the question's maths in delimiters; review the preview before saving"
            onClick={onRefine}
          >
            {refining ? <Spinner /> : null}
            {refining ? 'Refining…' : 'Refine LaTeX'}
          </Button>
        </div>
        {suggestion ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3 text-xs">
            <p className="m-0 text-ink-2">
              {Math.round(suggestion.confidence * 100)}% confidence
              {suggestion.usedImage ? ' · Figure reviewed' : ''}
              {suggestion.topicScope !== null ? ` · Topic chosen from ${String(suggestion.topicChoices)} in ${suggestion.topicScope}` : ''}
              {filledNothing ? ' · No fields filled' : ' · Check the updated fields before saving'}
            </p>
            {suggestion.notes.trim() !== '' ? <p className="m-0 text-ink-2">{suggestion.notes}</p> : null}
            {suggestion.answerWarnings.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
                <div className="flex items-start gap-2 text-xs text-ink-2 [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:flex-none">
                  <IconWarning />
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-warn">The suggested answer needs review before saving.</span>
                    {suggestion.answerWarnings.map((warning) => (
                      <span key={warning.kind}>{warning.detail}</span>
                    ))}
                  </div>
                </div>
                {questionType !== null ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" disabled={busy} onClick={onRunWithType}>
                      Ask again using {questionType.replace(/_/g, ' ').toLowerCase()} type
                    </Button>
                    <span className="text-ink-3">You can also edit the answer or question type yourself.</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : <p className="m-0 text-xs text-ink-3">{reason}</p>}
      </div>
    </details>
  );
}

/**
 * The right half of the fix workspace: one question, with every field it could need editable, the problems
 * open on it (each ignorable), and a live preview of the rendered question. Ctrl+Enter saves.
 */
export function FixPanel({
  questionId,
  target,
  ruleKind,
  ruleGroup,
  isPending,
  isError,
  summary,
  saving,
  aiBusy,
  saveRevision,
  onDirtyChange,
  onSave,
  onAiFix,
  onIgnore,
  onNext,
}: {
  questionId: string | null;
  target: FixTarget | undefined;
  /** The rule and group being worked on, which decide what the AI is asked for by default. */
  ruleKind: AnomalyKind | '';
  ruleGroup: AnomalyGroup | '';
  isPending: boolean;
  isError: boolean;
  summary: QualitySummary;
  saving: boolean;
  aiBusy: boolean;
  /** Incremented after a successful save, when the new server values should replace the draft. */
  saveRevision: number;
  onDirtyChange: (dirty: boolean) => void;
  /** `ai` names the fields saved with exactly the value the AI suggested, so they are tagged as AI-filled. */
  onSave: (fix: QuestionFix, andNext: boolean, ai: AiFillClaim | undefined) => void;
  /** `respectType`: the stored question type is confirmed, so the suggested answer must fit it. */
  onAiFix: (fields: AiFixField[], respectType?: boolean) => Promise<AiFixSuggestion>;
  onIgnore: (anomalyId: string) => void;
  onNext: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [refining, setRefining] = useState(false);
  const [aiFields, setAiFields] = useState<Set<PanelAiField>>(new Set());
  const [suggestion, setSuggestion] = useState<AiFixSuggestion | null>(null);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const draftSource = useRef<string | null>(null);
  const { success, error } = useToast();

  // What the AI is asked for by default: what THIS question is missing, narrowed to the rule being worked on
  // (picking "Answer" in the tree must not spend a call on a topic it also lacks). A field that is already
  // filled and unflagged is left unticked, so a run never overwrites good data. Every box stays editable.
  const plan = useMemo(
    () => (target ? planForQuestion(target, target.anomalies.map((anomaly) => anomaly.kind), ruleKind, ruleGroup) : null),
    [target, ruleKind, ruleGroup],
  );

  // Background refetches update the target without replacing unsaved edits. Only a different question or
  // an explicit successful save starts a new draft.
  useEffect(() => {
    if (questionId === null) {
      draftSource.current = null;
      setDraft(null);
      setSuggestion(null);
      setMoreDetailsOpen(false);
      return;
    }
    if (!target || target.questionId !== questionId) return;
    const source = `${questionId}:${String(saveRevision)}`;
    if (draftSource.current === source) return;
    draftSource.current = source;
    setDraft(toDraft(target));
    setSuggestion(null);
    setMoreDetailsOpen(false);
  }, [questionId, target, saveRevision]);

  // Re-ticked whenever the question or the selected rule changes; hand-ticked boxes survive until then.
  useEffect(() => {
    setAiFields(new Set((plan?.fields ?? []).filter((field): field is PanelAiField => field !== 'structure')));
  }, [plan]);

  const flagged = useMemo(() => {
    const fields = new Set<keyof Draft>();
    for (const anomaly of target?.anomalies ?? []) {
      const field = fieldOf(anomaly);
      if (field) fields.add(field);
    }
    return fields;
  }, [target]);

  const currentTarget = target?.questionId === questionId ? target : undefined;
  const draftReady = questionId !== null && draftSource.current === `${questionId}:${String(saveRevision)}`;
  const fix = currentTarget && draft && draftReady ? toFix(draft, currentTarget) : null;
  const dirty = fix !== null && Object.keys(fix).length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  if (questionId === null) {
    return <EmptyState title="Pick a question" body="Choose a question from the queue to fix it here." />;
  }
  if (isError && !currentTarget) return <p className="error">Could not load this question. It may no longer be in the live bank.</p>;
  if (isPending || !draft || !target || target.questionId !== questionId || !fix) return <LoadingState label="Loading question…" />;

  const patch = (changes: Partial<Draft>): void => {
    setDraft((current) => current ? { ...current, ...changes } : current);
  };
  const save = (andNext: boolean): void => { if (dirty) onSave(fix, andNext, aiClaim(draft, fix, suggestion)); };
  const verifyUrl = target.documentId === null ? null : `/verify?documentId=${encodeURIComponent(target.documentId)}&restore=1`;

  /**
   * The AI badge for one field. Saved data keeps its badge while the value is untouched; a value the AI just
   * suggested shows it will be tagged on save; anything the operator typed shows none — saving it removes
   * the tag, because the value is no longer the AI's.
   */
  const aiMark = (field: PanelAiField): AiMark | null => {
    const current = aiDraftValue(draft, field);
    const pending = aiClaim(draft, fix, suggestion)?.fields.includes(field) ?? false;
    if (pending) return { pending: true, title: 'Suggested by the AI — tagged as AI-filled when you save it unchanged' };
    const tag = target.aiFilled[field];
    return tag !== undefined && current === aiDraftValue(toDraft(target), field) ? { pending: false, title: describeTag(tag) } : null;
  };

  /** Run the AI on the ticked fields and fill in only what it actually decided; a null leaves a field as it was. */
  const runAi = (respectType: boolean): void => {
    const source = draftSource.current;
    void onAiFix([...aiFields], respectType).then((result) => {
      if (draftSource.current !== source) return;
      setSuggestion(result);
      if ((result.topic !== null && !flagged.has('topic')) || (result.level !== null && !flagged.has('level'))) {
        setMoreDetailsOpen(true);
      }
      patch({
        ...(result.topic !== null && { topic: result.topic }),
        ...(result.answer !== null && { answer: result.answer }),
        ...(result.solution !== null && { explanation: result.solution }),
        ...(result.level !== null && { level: result.level }),
      });
    });
  };

  /**
   * Ask the AI to wrap this question's maths in `\( \)` — the one case a rule cannot do safely, where a
   * formula sits inside a sentence. The result only fills the draft: nothing is written until Save, so
   * every suggestion is reviewed in the rendered preview first.
   */
  const refineWithAi = async (): Promise<void> => {
    const source = draftSource.current;
    setRefining(true);
    try {
      const [questionText, answer, ...options] = await Promise.all([
        refineLatex(draft.questionText),
        draft.answer.trim() === '' ? Promise.resolve(draft.answer) : refineLatex(draft.answer),
        ...draft.options.map((option) => refineLatex(option)),
      ]);
      if (draftSource.current !== source) return;
      patch({ questionText, answer, options });
      success('AI suggestion ready', 'Check the preview, then Save to keep it.');
    } catch (caught) {
      error('AI fix failed', caught instanceof Error ? caught.message : 'The refiner is not configured.');
    } finally {
      setRefining(false);
    }
  };

  const metadataControls: { name: keyof Draft; control: JSX.Element }[] = [
    {
      name: 'topic',
      control: <Field label="Topic" value={draft.topic} flagged={flagged.has('topic')} ai={aiMark('topic')}
        list={suggestion && suggestion.topicOptions.length > 0 ? 'quality-topics' : undefined}
        onChange={(topic) => { patch({ topic }); }} />,
    },
    {
      name: 'subject',
      control: <Field label="Subject" value={draft.subject} flagged={flagged.has('subject')} list="quality-subjects"
        onChange={(subject) => { patch({ subject }); }} />,
    },
    {
      name: 'chapter',
      control: <Field label="Chapter" value={draft.chapter} flagged={flagged.has('chapter')} list="quality-chapters"
        onChange={(chapter) => { patch({ chapter }); }} />,
    },
    {
      name: 'exam',
      control: <Field label="Exam" value={draft.exam} flagged={flagged.has('exam')}
        onChange={(exam) => { patch({ exam }); }} />,
    },
    {
      name: 'questionType',
      control: (
        <label className="flex flex-col gap-1">
          <FieldLabel label="Question type" flagged={flagged.has('questionType')} />
          <select
            value={KNOWN_QUESTION_TYPES.some((type) => type === draft.questionType) ? draft.questionType : ''}
            onChange={(event) => { patch({ questionType: event.target.value }); }}
            className={cn(INPUT, 'border-line')}
          >
            <option value="">{draft.questionType === '' ? '— not set —' : `keep "${draft.questionType}"`}</option>
            {KNOWN_QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      ),
    },
    {
      name: 'sectionName',
      control: <Field label="Section" value={draft.sectionName} flagged={flagged.has('sectionName')}
        onChange={(sectionName) => { patch({ sectionName }); }} />,
    },
    {
      name: 'level',
      control: (
        <label className="flex flex-col gap-1">
          <FieldLabel label="Level" flagged={flagged.has('level')} ai={aiMark('level')} />
          <select
            value={draft.level}
            onChange={(event) => { patch({ level: event.target.value }); }}
            className={cn(INPUT, 'border-line')}
          >
            <option value="">— not graded —</option>
            {QUESTION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
      ),
    },
  ];
  const flaggedMetadata = metadataControls.filter(({ name }) => flagged.has(name));
  const otherMetadata = metadataControls.filter(({ name }) => !flagged.has(name));

  return (
    // The question scrolls; the Save row does not. It sits outside the scroll area, so it is reachable at any
    // point in a long question without scrolling the page (which no longer scrolls at all here).
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(false); }
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {isError ? (
          <p role="alert" className="m-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
            Could not refresh this question. Your unsaved edits are still here; retry the connection before saving.
          </p>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-ink">
              {[target.subject, target.chapter, target.questionNumber !== null ? `Q${String(target.questionNumber)}` : null]
                .filter(Boolean)
                .join(' · ') || 'Untagged question'}
            </span>
            <span className="text-xs text-ink-3">
              {target.fileName ?? 'no source file'}
              {target.questionAddedAt !== null ? ` · added to bank ${formatDateTime(target.questionAddedAt)}` : ''}
              {target.ingestQuestionId === null ? ' · legacy row (no staging copy)' : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                void navigator.clipboard.writeText(target.questionId).then(() => { success('Question id copied', target.questionId); });
              }}
            >
              <IconCopy /> Copy id
            </Button>
            {verifyUrl !== null ? (
              <Link
                to={verifyUrl}
                className={buttonClasses('default', 'xs')}
                aria-disabled={saving}
                onClick={(event) => {
                  if (saving) { event.preventDefault(); return; }
                }}
              >
                Open in Verify
              </Link>
            ) : null}
          </div>
        </header>

        <section className="flex flex-col gap-2" aria-label="Open issues">
          {target.anomalies.length === 0 ? (
            <p className="m-0 text-sm text-ink-3">No open issues on this question.</p>
          ) : (
            <>
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-3">
                {target.anomalies.length} open issue{target.anomalies.length === 1 ? '' : 's'}
              </h3>
              <div className="divide-y divide-line rounded-lg border border-line">
                {target.anomalies.map((anomaly) => (
                  <div key={anomaly.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium text-ink">{ANOMALY_KINDS[anomaly.kind].label}</span>
                        <span className={cn('text-xs capitalize', anomaly.severity === 'high' ? 'text-bad' : 'text-ink-3')}>
                          {anomaly.severity}
                        </span>
                      </div>
                      <span className="text-xs leading-relaxed text-ink-2">{anomaly.detail}</span>
                    </div>
                    <Button variant="ghost" size="xs" onClick={() => { onIgnore(anomaly.id); }}>
                      <IconCheck /> Ignore
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {flaggedMetadata.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Flagged question details">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-3">Details to correct</h3>
            <div className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
              {flaggedMetadata.map(({ name, control }) => <div key={name}>{control}</div>)}
            </div>
          </section>
        ) : null}
        {suggestion && suggestion.topicOptions.length > 0 ? (
          <datalist id="quality-topics">
            {suggestion.topicOptions.map((topic) => <option key={topic} value={topic} />)}
          </datalist>
        ) : null}
        <datalist id="quality-subjects">{summary.subjects.map((subject) => <option key={subject} value={subject} />)}</datalist>
        <datalist id="quality-chapters">{summary.chapters.map((chapter) => <option key={chapter} value={chapter} />)}</datalist>

        <section className="flex flex-col gap-1">
          <FieldLabel label="Question text" flagged={flagged.has('questionText')} />
          <Editable flagged={flagged.has('questionText')}>
            <EditableLatexValue
              multiline
              value={draft.questionText}
              placeholder="Click to write the question"
              onChange={(questionText) => { patch({ questionText }); }}
            />
          </Editable>
        </section>

        <section className="flex flex-col gap-1.5">
          <FieldLabel label="Options" flagged={flagged.has('options')} />
          {draft.options.map((option, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Editable flagged={flagged.has('options')}>
                  <EditableLatexValue
                    value={option}
                    placeholder="Click to write this option"
                    onChange={(value) => {
                      patch({ options: draft.options.map((current, i) => (i === index ? value : current)) });
                    }}
                  />
                </Editable>
              </div>
              <Button
                variant="ghost"
                size="xs"
                title="Remove this option"
                onClick={() => { patch({ options: draft.options.filter((_, i) => i !== index) }); }}
              >
                <IconTrash />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              onClick={() => {
                const label = String.fromCharCode('A'.charCodeAt(0) + draft.options.length);
                patch({ options: [...draft.options, `(${label}) `] });
              }}
            >
              <IconPlus /> Add option
            </Button>
            {draft.options.length === 0 ? <span className="text-xs text-ink-3">No options (fine for subjective and integer questions).</span> : null}
            {target.optionImages.length > 0 ? (
              <span className="text-xs text-ink-3">{target.optionImages.length} option image(s) — fix pictures in Verify.</span>
            ) : null}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          <div className="flex flex-col gap-1">
            <FieldLabel label="Answer" flagged={flagged.has('answer')} ai={aiMark('answer')} />
            <Editable flagged={flagged.has('answer')}>
              <EditableLatexValue
                value={draft.answer}
                placeholder="Click to write the answer"
                onChange={(answer) => { patch({ answer }); }}
              />
            </Editable>
            <span className="text-xs text-ink-3">
              {draft.options.length > 0
                ? `Use a label from the options: ${draft.options.map((o) => /^\s*\(?\s*([A-Za-z]|\d{1,2})\s*[).]/.exec(o)?.[1] ?? '?').join(', ')}`
                : 'Free text — no options on this question.'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel label="Explanation" flagged={flagged.has('explanation')} ai={aiMark('solution')} />
            <Editable flagged={flagged.has('explanation')}>
              <EditableLatexValue
                multiline
                value={draft.explanation}
                placeholder="Click to write the worked solution"
                onChange={(explanation) => { patch({ explanation }); }}
              />
            </Editable>
          </div>
        </section>

        {otherMetadata.length > 0 ? (
          <details
            className="rounded-lg border border-line"
            open={moreDetailsOpen}
            onToggle={(event) => { setMoreDetailsOpen(event.currentTarget.open); }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-brand-soft [&::-webkit-details-marker]:hidden">
              <span className="font-medium text-ink">Other question details</span>
              <span className="text-xs text-ink-3">{otherMetadata.length} editable field{otherMetadata.length === 1 ? '' : 's'}</span>
            </summary>
            <div className="grid grid-cols-3 gap-3 border-t border-line px-3 py-3 max-[900px]:grid-cols-2 max-[560px]:grid-cols-1">
              {otherMetadata.map(({ name, control }) => <div key={name}>{control}</div>)}
            </div>
          </details>
        ) : null}

        <AiFixBar
          key={`${target.questionId}:${String(saveRevision)}`}
          selected={aiFields}
          suggestion={suggestion}
          busy={aiBusy}
          refining={refining}
          onToggle={(field) => {
            setAiFields((prev) => {
              const next = new Set(prev);
              if (next.has(field)) next.delete(field);
              else next.add(field);
              return next;
            });
          }}
          questionType={target.questionType}
          reason={plan?.reason ?? ''}
          onRun={() => { runAi(false); }}
          onRunWithType={() => { runAi(true); }}
          onRefine={() => { void refineWithAi(); }}
        />
      </div>

      <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
        <Button disabled={!dirty || saving} onClick={() => { save(false); }}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button disabled={!dirty || saving} onClick={() => { save(true); }}>Save & next</Button>
        <Button variant="ghost" disabled={saving} onClick={onNext}>Skip →</Button>
        {dirty ? (
          <Button variant="ghost" size="xs" disabled={saving} onClick={() => { setDraft(toDraft(target)); }}>Discard changes</Button>
        ) : null}
        <span className="ml-auto text-xs text-ink-3">
          {dirty ? 'Unsaved changes · Ctrl+Enter to save' : 'No unsaved changes'}
        </span>
      </footer>
    </div>
  );
}
