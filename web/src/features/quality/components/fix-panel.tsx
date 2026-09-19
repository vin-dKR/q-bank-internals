import { type JSX, useEffect, useMemo, useState } from 'react';
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
  Badge,
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
import { SEVERITY_TONE, formatDateTime } from '../lib/anomaly-display.js';
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
        'ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-px align-middle text-[10px] font-semibold uppercase tracking-wide [&>svg]:size-3',
        mark.pending ? 'border border-dashed border-brand text-brand' : 'bg-brand-soft text-brand',
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
  return <div className={cn('rounded-lg', flagged && 'ring-2 ring-bad/40')}>{children}</div>;
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
        className={cn(INPUT, flagged ? 'border-bad' : 'border-line')}
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
  onToggle,
  onRun,
  onRunWithType,
}: {
  selected: Set<PanelAiField>;
  suggestion: AiFixSuggestion | null;
  /** Why these boxes are ticked — shown until a suggestion replaces it with what came back. */
  reason: string;
  /** The question's stored type, named in the "ask again" button. */
  questionType: string | null;
  busy: boolean;
  onToggle: (field: PanelAiField) => void;
  onRun: () => void;
  /** Re-run with the stored type confirmed, so the answer must fit it. */
  onRunWithType: () => void;
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
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Fix with AI</span>
        {PANEL_AI_FIELDS.map((field) => (
          <label key={field} className="flex cursor-pointer items-center gap-1.5 text-sm text-ink-2">
            <input
              type="checkbox"
              className="size-4 w-auto accent-brand"
              checked={selected.has(field)}
              onChange={() => { onToggle(field); }}
            />
            {AI_FIELD_LABELS[field]}
          </label>
        ))}
        <Button
          variant="primary"
          size="xs"
          disabled={busy || selected.size === 0}
          title={selected.size === 0 ? 'Tick a field for the AI to work out' : undefined}
          onClick={onRun}
        >
          {busy ? <Spinner /> : <IconSparkle />}
          {busy ? 'Solving…' : `Run on ${String(selected.size)} field${selected.size === 1 ? '' : 's'}`}
        </Button>
        {suggestion ? null : <span className="text-xs text-ink-3">{reason}</span>}
      </div>
      {suggestion ? (
        <div className="flex flex-col gap-1 border-t border-line pt-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={suggestion.confidence >= 0.75 ? 'success' : suggestion.confidence >= 0.5 ? 'progress' : 'danger'}>
              {Math.round(suggestion.confidence * 100)}% confident
            </Badge>
            {filledNothing ? <Badge tone="danger">nothing filled in</Badge> : null}
            {suggestion.usedImage ? <Badge tone="info">read the figure</Badge> : null}
            {suggestion.topicScope !== null ? (
              <span className="text-ink-3">
                topic chosen from {suggestion.topicChoices} in {suggestion.topicScope}
              </span>
            ) : null}
            <span className="text-ink-3">
              {filledNothing ? 'Nothing was accepted — see why below.' : 'Filled in below — check it, then Save.'}
            </span>
          </div>
          {suggestion.notes.trim() !== '' ? <p className="m-0 text-ink-2">{suggestion.notes}</p> : null}
          {suggestion.answerWarnings.length > 0 ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-warn/40 bg-warn-soft px-2.5 py-2">
              <div className="flex items-start gap-1.5 text-warn [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:flex-none">
                <IconWarning />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">The suggested answer does not fit this question — check it before saving</span>
                  {suggestion.answerWarnings.map((warning) => (
                    <span key={warning.kind} className="text-ink-2">{warning.detail}</span>
                  ))}
                </div>
              </div>
              {questionType !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="xs" disabled={busy} onClick={onRunWithType}>
                    <IconSparkle /> It is {questionType.replace(/_/g, ' ').toLowerCase()} — ask the AI again
                  </Button>
                  <span className="text-ink-3">or correct the Answer or Question type below yourself.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
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
  const { success, error } = useToast();

  // What the AI is asked for by default: what THIS question is missing, narrowed to the rule being worked on
  // (picking "Answer" in the tree must not spend a call on a topic it also lacks). A field that is already
  // filled and unflagged is left unticked, so a run never overwrites good data. Every box stays editable.
  const plan = useMemo(
    () => (target ? planForQuestion(target, target.anomalies.map((anomaly) => anomaly.kind), ruleKind, ruleGroup) : null),
    [target, ruleKind, ruleGroup],
  );

  // A new question replaces the draft; editing keeps it. Keyed on the id so an unsaved draft is never
  // carried onto a different question.
  useEffect(() => {
    setDraft(target ? toDraft(target) : null);
    setSuggestion(null);
  }, [target]);

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

  if (questionId === null) {
    return <EmptyState title="Pick a question" body="Choose a question from the queue to fix it here." />;
  }
  if (isPending || !draft || !target) return <LoadingState label="Loading question…" />;
  if (isError) return <p className="error">Could not load this question. It may no longer be in the live bank.</p>;

  const fix = toFix(draft, target);
  const dirty = Object.keys(fix).length > 0;
  const patch = (changes: Partial<Draft>): void => { setDraft({ ...draft, ...changes }); };
  const save = (andNext: boolean): void => { if (dirty) onSave(fix, andNext, aiClaim(draft, fix, suggestion)); };

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
    void onAiFix([...aiFields], respectType).then((result) => {
      setSuggestion(result);
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
    setRefining(true);
    try {
      const [questionText, answer, ...options] = await Promise.all([
        refineLatex(draft.questionText),
        draft.answer.trim() === '' ? Promise.resolve(draft.answer) : refineLatex(draft.answer),
        ...draft.options.map((option) => refineLatex(option)),
      ]);
      patch({ questionText, answer, options });
      success('AI suggestion ready', 'Check the preview, then Save to keep it.');
    } catch (caught) {
      error('AI fix failed', caught instanceof Error ? caught.message : 'The refiner is not configured.');
    } finally {
      setRefining(false);
    }
  };

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
            <Button
              size="xs"
              disabled={refining}
              title="Wrap this question's maths in \( \) using the AI refiner — fills the form, saves nothing"
              onClick={() => { void refineWithAi(); }}
            >
              {refining ? <Spinner /> : <IconSparkle />}
              {refining ? 'Asking AI…' : 'Fix LaTeX with AI'}
            </Button>
            {target.documentId !== null ? (
              <Link
                to={`/verify?documentId=${encodeURIComponent(target.documentId)}&restore=1`}
                className={buttonClasses('default', 'xs')}
              >
                Open in Verify
              </Link>
            ) : null}
          </div>
        </header>

        <AiFixBar
          selected={aiFields}
          suggestion={suggestion}
          busy={aiBusy}
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
        />

        <section className="flex flex-col gap-1.5">
          {target.anomalies.length === 0 ? (
            <p className="m-0 text-sm text-ok">No problems left on this question.</p>
          ) : (
            target.anomalies.map((anomaly) => (
              <div key={anomaly.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[anomaly.severity]}>{anomaly.severity}</Badge>
                  <span className="text-[13px] font-medium text-ink">{ANOMALY_KINDS[anomaly.kind].label}</span>
                  <span className="text-xs text-ink-2">{anomaly.detail}</span>
                </div>
                <Button variant="ghost" size="xs" onClick={() => { onIgnore(anomaly.id); }}>
                  <IconCheck /> Ignore
                </Button>
              </div>
            ))
          )}
        </section>

        <section className="grid grid-cols-3 gap-3 max-[900px]:grid-cols-2">
          <Field
            label="Topic"
            value={draft.topic}
            flagged={flagged.has('topic')}
            ai={aiMark('topic')}
            list={suggestion && suggestion.topicOptions.length > 0 ? 'quality-topics' : undefined}
            onChange={(topic) => { patch({ topic }); }}
          />
          {suggestion && suggestion.topicOptions.length > 0 ? (
            <datalist id="quality-topics">
              {suggestion.topicOptions.map((topic) => <option key={topic} value={topic} />)}
            </datalist>
          ) : null}
          <Field label="Subject" value={draft.subject} flagged={flagged.has('subject')} list="quality-subjects" onChange={(subject) => { patch({ subject }); }} />
          <Field label="Chapter" value={draft.chapter} flagged={flagged.has('chapter')} list="quality-chapters" onChange={(chapter) => { patch({ chapter }); }} />
          <Field label="Exam" value={draft.exam} flagged={flagged.has('exam')} onChange={(exam) => { patch({ exam }); }} />
          <label className="flex flex-col gap-1">
            <span className={cn('text-xs font-medium', flagged.has('questionType') ? 'text-bad' : 'text-ink-2')}>
              Question type{flagged.has('questionType') ? ' — needs fixing' : ''}
            </span>
            <select
              value={KNOWN_QUESTION_TYPES.some((type) => type === draft.questionType) ? draft.questionType : ''}
              onChange={(event) => { patch({ questionType: event.target.value }); }}
              className={cn(INPUT, flagged.has('questionType') ? 'border-bad' : 'border-line')}
            >
              <option value="">{draft.questionType === '' ? '— not set —' : `keep "${draft.questionType}"`}</option>
              {KNOWN_QUESTION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <Field label="Section" value={draft.sectionName} flagged={flagged.has('sectionName')} onChange={(sectionName) => { patch({ sectionName }); }} />
          <label className="flex flex-col gap-1">
            <FieldLabel label="Level" flagged={flagged.has('level')} ai={aiMark('level')} />
            <select
              value={draft.level}
              onChange={(event) => { patch({ level: event.target.value }); }}
              className={cn(INPUT, flagged.has('level') ? 'border-bad' : 'border-line')}
            >
              <option value="">— not graded —</option>
              {QUESTION_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <datalist id="quality-subjects">{summary.subjects.map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="quality-chapters">{summary.chapters.map((c) => <option key={c} value={c} />)}</datalist>
        </section>

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
            <FieldLabel label="Explanation" flagged={false} ai={aiMark('solution')} />
            <EditableLatexValue
              multiline
              value={draft.explanation}
              placeholder="Click to write the worked solution"
              onChange={(explanation) => { patch({ explanation }); }}
            />
          </div>
        </section>
      </div>

      <footer className="flex flex-none flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3">
        <Button variant="primary" disabled={!dirty || saving} onClick={() => { save(false); }}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button disabled={!dirty || saving} onClick={() => { save(true); }}>Save & next</Button>
        <Button variant="ghost" onClick={onNext}>Skip →</Button>
        {dirty ? (
          <Button variant="ghost" size="xs" onClick={() => { setDraft(toDraft(target)); }}>Discard changes</Button>
        ) : null}
        <span className="ml-auto text-xs text-ink-3">
          {dirty ? 'Unsaved changes · Ctrl+Enter to save' : 'Saved to the bank and its staging copy'}
        </span>
      </footer>
    </div>
  );
}
