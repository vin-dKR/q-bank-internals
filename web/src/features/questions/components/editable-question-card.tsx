import type { JSX } from 'react';
import { useState } from 'react';
import { KNOWN_QUESTION_TYPES, type Question, type ReExtractedQuestion } from '@ingest/contracts';
import { Badge, Button, Combobox, IconButton, IconPlus, IconScan, IconSparkle, IconUndo, IconX, Spinner } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { questionsApi } from '../api/questions.api.js';
import { useUpdateQuestion } from '../hooks/use-questions.js';
import type { QuestionDraft } from '../hooks/use-question-drafts.js';

/** A not-yet-saved crop region of this question: uploading (`saving`) or awaiting a manual retry. */
export type CardBox = { id: string; type: 'question' | 'option'; optionIndex: number; label: string; saving: boolean };

/** Which of this question's targets is armed for a rubber-band draw on the page. */
export type CardDrawTarget = { type: 'question' | 'option'; optionIndex: number };

type Props = {
  question: Question;
  /** The printed question number from the PDF (falls back to the sheet-order ordinal upstream). */
  number: number;
  /** The working copy of the question's text fields — owned by the workspace's draft store. */
  draft: QuestionDraft;
  /** True when the draft differs from the server row (shows the indicator, enables Update). */
  dirty: boolean;
  /** True while this question's edits are being pushed. */
  saving: boolean;
  boxes: CardBox[];
  /** Non-null while the canvas is in draw mode for one of this question's targets. */
  drawTarget: CardDrawTarget | null;
  /**
   * True while the whole-document detect run is in flight: pauses this card's image controls so a
   * manual save cannot race the run's own patches (each would clobber the other's image fields).
   */
  cropDisabled?: boolean;
  /** Session-level context, surfaced read-only so the operator sees where this question is filed. */
  exam?: string | null;
  subject?: string | null;
  /** Suggestions for the creatable dropdowns (existing sections / chapters across the workspace). */
  sectionOptions?: readonly string[];
  topicOptions?: readonly string[];
  onDraftChange: (draft: QuestionDraft) => void;
  onSave: () => void;
  /** Arm (or, on the armed target, cancel) draw mode — the drawn crop then saves automatically. */
  onDrawRegion: (question: Question, type: 'question' | 'option', optionIndex?: number) => void;
  /** Retry the auto-save of a region whose upload failed. */
  onSaveBox: (boxId: string) => void;
  onDeleteBox: (boxId: string) => void;
};

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';

/** A tiny ghost icon button for one of a field's AI actions ("Fix LaTeX" or "read the page again"). */
function AiButton({
  busy,
  disabled = false,
  title,
  icon,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  title: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button variant="ghost" size="xs" disabled={busy || disabled} onClick={onClick} title={title}>
      {busy ? '…' : icon}
    </Button>
  );
}

/**
 * The editable per-question card in Verify. Fields always render in the sheet's own order —
 * question text, options, answer, explanation, then metadata — and every LaTeX-bearing field
 * displays RENDERED via {@link EditableLatexValue} (click to edit the raw source). Text edits are
 * LOCAL-FIRST: they change only the passed-in draft; nothing hits the database until Update (this
 * card) or Update all (the workspace) pushes the dirty questions. Image flags, crops, and image
 * removal stay immediate — they are uploads against the freshest server data, not text edits.
 * Figure crops are draw-to-save: "Add region" arms the page canvas, the drawn crop uploads +
 * attaches by itself, and the attached image appears here — the card only lists regions still
 * uploading or needing a retry.
 */
export function EditableQuestionCard({
  question,
  number,
  draft,
  dirty,
  saving,
  boxes,
  drawTarget,
  cropDisabled = false,
  exam,
  subject,
  sectionOptions = [],
  topicOptions = [],
  onDraftChange,
  onSave,
  onDrawRegion,
  onSaveBox,
  onDeleteBox,
}: Props): JSX.Element {
  const update = useUpdateQuestion();
  const [fixing, setFixing] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  // The value each field held just before its last AI action replaced it — a one-deep, per-field undo.
  // An AI re-read of the answer/explanation commonly returns "" (question papers rarely print the
  // answer), which would silently wipe a good value; this lets the operator put it straight back.
  const [preAi, setPreAi] = useState<Record<string, string>>({});

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]): void => {
    onDraftChange({ ...draft, [key]: value });
  };
  const setOption = (i: number, body: string): void => {
    onDraftChange({
      ...draft,
      options: draft.options.map((o, j) => (j === i ? { ...o, body } : o)),
    });
  };

  /** Apply an AI-produced value to a field, remembering the previous value so it can be undone. */
  const applyAi = (key: string, previous: string, next: string, apply: (t: string) => void): void => {
    setPreAi((prev) => ({ ...prev, [key]: previous }));
    apply(next);
  };
  /** Put a field back to what it held before its last AI action, and drop its undo entry. */
  const undoAi = (key: string, apply: (t: string) => void): void => {
    const previous = preAi[key];
    if (previous === undefined) return;
    apply(previous);
    setPreAi((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
  };

  const refine = async (field: string, value: string, apply: (t: string) => void): Promise<void> => {
    setFixing(field);
    try {
      applyAi(field, value, await questionsApi.refine(value), apply);
    } finally {
      setFixing(null);
    }
  };

  // "Read the page again": re-extract this question from its source page image and drop ONE field of
  // the fresh result into the draft. Each field's second AI button re-reads independently (a few
  // seconds per call), so a click on the answer/explanation can also fill a field left blank on the
  // question sheet whenever the page itself shows it.
  const reExtract = async (
    field: string,
    apply: (fresh: ReExtractedQuestion) => void,
  ): Promise<void> => {
    setReading(field);
    try {
      apply(await questionsApi.reExtract(question.documentId, question.id));
    } finally {
      setReading(null);
    }
  };

  /**
   * The AI buttons a text field carries: sparkle = clean this field's LaTeX in place; scan = re-read
   * the whole question from the page and pull just this field out of the fresh extraction; undo =
   * restore the value the last AI action replaced (shown only once one has run). The first two are
   * mutually exclusive per field so a re-read never races an in-place refine.
   */
  const fieldAi = (
    key: string,
    current: string,
    applyText: (text: string) => void,
    pick: (fresh: ReExtractedQuestion) => string | null,
  ): JSX.Element => (
    <>
      <AiButton
        busy={fixing === key}
        disabled={reading === key}
        title="Fix LaTeX with AI"
        icon={<IconSparkle />}
        onClick={() => { void refine(key, current, applyText); }}
      />
      <AiButton
        busy={reading === key}
        disabled={fixing === key}
        title="Re-read this question from the page"
        icon={<IconScan />}
        onClick={() => {
          void reExtract(key, (fresh) => {
            const value = pick(fresh);
            if (value !== null) applyAi(key, current, value, applyText);
          });
        }}
      />
      {preAi[key] !== undefined ? (
        <AiButton
          busy={false}
          disabled={fixing === key || reading === key}
          title="Undo the last AI change to this field"
          icon={<IconUndo />}
          onClick={() => { undoAi(key, applyText); }}
        />
      ) : null}
    </>
  );

  const toggle = (key: 'isQuestionImage' | 'isOptionImage', value: boolean): void => {
    void update.mutateAsync({ id: question.id, patch: { [key]: value } });
  };

  const removeQuestionImage = (url: string): void => {
    const urls = splitUrls(question.questionImage).filter((u) => u !== url);
    void update.mutateAsync({ id: question.id, patch: { questionImage: urls.length ? urls.join(',') : null } });
  };
  const removeOptionImage = (optionIndex: number): void => {
    const optionImages = [...question.optionImages];
    optionImages[optionIndex] = '';
    void update.mutateAsync({ id: question.id, patch: { optionImages } });
  };

  const armedFor = (type: 'question' | 'option', optionIndex = 0): boolean =>
    drawTarget !== null && drawTarget.type === type && drawTarget.optionIndex === optionIndex;
  const qBoxes = boxes.filter((b) => b.type === 'question');
  const savedQ = splitUrls(question.questionImage);
  const specs = [exam, subject, question.path.module, question.path.chapter, question.path.section].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  const questionTypeOptions = [...new Set([...KNOWN_QUESTION_TYPES, ...(question.questionType ? [question.questionType] : [])])];
  const topicSuggestions = [...new Set([question.path.chapter, ...topicOptions].filter(Boolean))];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">Q{number}</span>
        {dirty ? <Badge tone="progress">Unsaved</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="w-auto" checked={question.isQuestionImage} onChange={(e) => { toggle('isQuestionImage', e.target.checked); }} />
            Q image
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="w-auto" checked={question.isOptionImage} onChange={(e) => { toggle('isOptionImage', e.target.checked); }} />
            Opt images
          </label>
        </div>
      </div>

      {specs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
          {specs.map((part, i) => (
            <span key={`${part}-${String(i)}`} className="inline-flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden className="text-line-strong">›</span> : null}
              {part}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
          Question text {fieldAi('stem', draft.stem, (t) => { set('stem', t); }, (fresh) => fresh.stem)}
        </span>
        <EditableLatexValue value={draft.stem} onChange={(v) => { set('stem', v); }} multiline />
      </div>

      {question.isQuestionImage ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className={FIELD_LABEL}>Question figures</span>
            <Button
              size="xs"
              variant={armedFor('question') ? 'primary' : 'default'}
              disabled={cropDisabled}
              title={armedFor('question') ? 'Cancel drawing' : 'Draw the figure on the page — it saves automatically'}
              onClick={() => { onDrawRegion(question, 'question'); }}
            >
              {armedFor('question') ? 'Drawing… (Esc to cancel)' : <><IconPlus /> Add region</>}
            </Button>
          </div>
          {qBoxes.map((box) => (
            <div key={box.id} className="flex items-center justify-between gap-1.5">
              <span className="text-sm text-ink-2">Region {box.label}</span>
              <div className="flex items-center gap-2">
                {box.saving ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-ink-2"><Spinner /> Saving…</span>
                ) : (
                  <>
                    <Button size="xs" disabled={cropDisabled} onClick={() => { onSaveBox(box.id); }}>Save</Button>
                    <Button variant="ghost" size="xs" onClick={() => { onDeleteBox(box.id); }}>Remove</Button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
            {savedQ.map((url) => (
              <div key={url} className="flex flex-col items-start gap-1">
                <img src={url} alt="question figure" className="max-h-36 max-w-full rounded-lg border border-line bg-white" />
                <Button variant="ghost" size="xs" disabled={cropDisabled} onClick={() => { removeQuestionImage(url); }}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className={FIELD_LABEL}>Options</span>
          <Button
            size="xs"
            onClick={() => {
              const nextLabel = String.fromCharCode(65 + draft.options.length);
              set('options', [...draft.options, { label: nextLabel, body: '', isCorrect: false }]);
            }}
          >
            <IconPlus /> Add option
          </Button>
        </div>
        {draft.options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <strong>{option.label}.</strong>
            <div className="flex-1">
              <EditableLatexValue value={option.body} onChange={(v) => { setOption(i, v); }} placeholder="Click to edit option" />
            </div>
            {fieldAi(
              `opt${String(i)}`,
              option.body,
              (t) => { setOption(i, t); },
              (fresh) => fresh.options[i]?.body ?? null,
            )}
            {question.isOptionImage ? (
              <Button
                size="xs"
                variant={armedFor('option', i) ? 'primary' : 'default'}
                disabled={cropDisabled}
                title={armedFor('option', i) ? 'Cancel drawing' : 'Draw this option’s figure on the page — it saves automatically'}
                onClick={() => { onDrawRegion(question, 'option', i); }}
              >
                {armedFor('option', i) ? 'Drawing…' : 'Region'}
              </Button>
            ) : null}
            <IconButton
              icon={<IconX />}
              label="Remove option"
              size="sm"
              onClick={() => { set('options', draft.options.filter((_, j) => j !== i)); }}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
          Answer {fieldAi('answer', draft.answer, (t) => { set('answer', t); }, (fresh) => fresh.answer)}
        </span>
        <EditableLatexValue value={draft.answer} onChange={(v) => { set('answer', v); }} placeholder="Click to add answer" />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
          Explanation {fieldAi('explanation', draft.explanation, (t) => { set('explanation', t); }, (fresh) => fresh.explanation ?? '')}
        </span>
        <EditableLatexValue value={draft.explanation} onChange={(v) => { set('explanation', v); }} multiline placeholder="Click to add explanation" />
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Question type</span>
          <Combobox
            value={draft.questionType}
            options={questionTypeOptions}
            placeholder="Select type…"
            onChange={(v) => { set('questionType', v); }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Section</span>
          <Combobox
            value={draft.sectionName}
            options={sectionOptions}
            placeholder="e.g. Exercise-1"
            onChange={(v) => { set('sectionName', v); }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Topic</span>
          <Combobox
            value={draft.topic}
            options={topicSuggestions}
            placeholder="e.g. Kinematics"
            onChange={(v) => { set('topic', v); }}
          />
        </label>
      </div>

      {question.isOptionImage ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2 p-2.5">
          <span className={FIELD_LABEL}>Option figures</span>
          {question.options.map((option, optIdx) => {
            const oBoxes = boxes.filter((b) => b.type === 'option' && b.optionIndex === optIdx);
            const savedO = question.optionImages[optIdx];
            return (
              <div key={option.label} className="flex flex-col gap-1.5">
                <span><strong>{option.label}.</strong></span>
                {oBoxes.map((box) => (
                  <div key={box.id} className="flex items-center justify-between gap-1.5">
                    <span className="text-sm text-ink-2">Region {box.label}</span>
                    <div className="flex items-center gap-2">
                      {box.saving ? (
                        <span className="inline-flex items-center gap-1.5 text-sm text-ink-2"><Spinner /> Saving…</span>
                      ) : (
                        <>
                          <Button size="xs" disabled={cropDisabled} onClick={() => { onSaveBox(box.id); }}>Save</Button>
                          <Button variant="ghost" size="xs" onClick={() => { onDeleteBox(box.id); }}>Remove</Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {savedO ? (
                  <div className="flex flex-col items-start gap-1">
                    <img src={savedO} alt={`option ${option.label}`} className="max-h-36 max-w-full rounded-lg border border-line bg-white" />
                    <Button variant="ghost" size="xs" onClick={() => { removeOptionImage(optIdx); }}>Remove</Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button size="xs" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Update'}
        </Button>
      </div>
    </div>
  );
}
