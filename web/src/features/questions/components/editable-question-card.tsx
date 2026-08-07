import type { JSX } from 'react';
import { useState } from 'react';
import { KNOWN_QUESTION_TYPES, type Question } from '@ingest/contracts';
import { Badge, Button, Combobox, IconButton, IconPlus, IconSparkle, IconX } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { questionsApi } from '../api/questions.api.js';
import { useUpdateQuestion } from '../hooks/use-questions.js';
import type { QuestionDraft } from '../hooks/use-question-drafts.js';

/** Minimal box info the card needs to render its crop-region rows. */
export type CardBox = { id: string; type: 'question' | 'option'; optionIndex: number; label: string };

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
  busyBoxIds: Set<string>;
  /** Session-level context, surfaced read-only so the operator sees where this question is filed. */
  exam?: string | null;
  subject?: string | null;
  /** Suggestions for the creatable dropdowns (existing sections / chapters across the workspace). */
  sectionOptions?: readonly string[];
  topicOptions?: readonly string[];
  onDraftChange: (draft: QuestionDraft) => void;
  onSave: () => void;
  onAddBox: (question: Question, type: 'question' | 'option', optionIndex?: number) => void;
  onCropSave: (boxId: string) => void;
  onDeleteBox: (boxId: string) => void;
};

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';

/** A tiny sparkle button that AI-refines a single field's LaTeX. */
function AiButton({ busy, onClick }: { busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <Button variant="ghost" size="xs" disabled={busy} onClick={onClick} title="Fix LaTeX with AI">
      {busy ? '…' : <IconSparkle />}
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
 */
export function EditableQuestionCard({
  question,
  number,
  draft,
  dirty,
  saving,
  boxes,
  busyBoxIds,
  exam,
  subject,
  sectionOptions = [],
  topicOptions = [],
  onDraftChange,
  onSave,
  onAddBox,
  onCropSave,
  onDeleteBox,
}: Props): JSX.Element {
  const update = useUpdateQuestion();
  const [fixing, setFixing] = useState<string | null>(null);

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]): void => {
    onDraftChange({ ...draft, [key]: value });
  };
  const setOption = (i: number, body: string): void => {
    onDraftChange({
      ...draft,
      options: draft.options.map((o, j) => (j === i ? { ...o, body } : o)),
    });
  };

  const refine = async (field: string, value: string, apply: (t: string) => void): Promise<void> => {
    setFixing(field);
    try {
      apply(await questionsApi.refine(value));
    } finally {
      setFixing(null);
    }
  };

  const toggle = (key: 'isQuestionImage' | 'isOptionImage', value: boolean): void => {
    void update.mutateAsync({ id: question.id, patch: { [key]: value } });
  };

  const removeQuestionImage = (url: string): void => {
    const urls = splitUrls(question.questionImage).filter((u) => u !== url);
    void update.mutateAsync({ id: question.id, patch: { questionImage: urls.length ? urls.join(',') : null } });
  };

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
          Question text <AiButton busy={fixing === 'stem'} onClick={() => { void refine('stem', draft.stem, (t) => { set('stem', t); }); }} />
        </span>
        <EditableLatexValue value={draft.stem} onChange={(v) => { set('stem', v); }} multiline />
      </div>

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
            <AiButton busy={fixing === `opt${String(i)}`} onClick={() => { void refine(`opt${String(i)}`, option.body, (t) => { setOption(i, t); }); }} />
            {question.isOptionImage ? (
              <Button size="xs" onClick={() => { onAddBox(question, 'option', i); }}>Region</Button>
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
          Answer <AiButton busy={fixing === 'answer'} onClick={() => { void refine('answer', draft.answer, (t) => { set('answer', t); }); }} />
        </span>
        <EditableLatexValue value={draft.answer} onChange={(v) => { set('answer', v); }} placeholder="Click to add answer" />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
          Explanation <AiButton busy={fixing === 'explanation'} onClick={() => { void refine('explanation', draft.explanation, (t) => { set('explanation', t); }); }} />
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

      {question.isQuestionImage ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className={FIELD_LABEL}>Question figures</span>
            <Button size="xs" onClick={() => { onAddBox(question, 'question'); }}><IconPlus /> Add region</Button>
          </div>
          {qBoxes.map((box) => (
            <div key={box.id} className="flex items-center justify-between gap-1.5">
              <span className="text-sm text-ink-2">Region {box.label}</span>
              <div className="flex items-center gap-2">
                <Button size="xs" disabled={busyBoxIds.has(box.id)} onClick={() => { onCropSave(box.id); }}>
                  {busyBoxIds.has(box.id) ? 'Saving…' : 'Crop & save'}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => { onDeleteBox(box.id); }}>Remove</Button>
              </div>
            </div>
          ))}
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
            {savedQ.map((url) => (
              <div key={url} className="flex flex-col items-start gap-1">
                <img src={url} alt="question figure" className="max-h-36 max-w-full rounded-lg border border-line bg-white" />
                <Button variant="ghost" size="xs" onClick={() => { removeQuestionImage(url); }}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
                  <Button key={box.id} size="xs" disabled={busyBoxIds.has(box.id)} onClick={() => { onCropSave(box.id); }}>
                    {busyBoxIds.has(box.id) ? 'Saving…' : 'Crop & save option'}
                  </Button>
                ))}
                {savedO ? (
                  <div className="flex flex-col items-start gap-1">
                    <img src={savedO} alt={`option ${option.label}`} className="max-h-36 max-w-full rounded-lg border border-line bg-white" />
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
