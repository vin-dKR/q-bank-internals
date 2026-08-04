import { type JSX, useEffect, useState } from 'react';
import type { Question, QuestionOption } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { questionsApi } from '../api/questions.api.js';
import { useUpdateQuestion } from '../hooks/use-questions.js';

/** Minimal box info the card needs to render its crop-region rows. */
export type CardBox = { id: string; type: 'question' | 'option'; optionIndex: number; label: string };

type Props = {
  question: Question;
  index: number;
  boxes: CardBox[];
  busyBoxIds: Set<string>;
  /** Fallbacks from the document, used when the question's own metadata is still blank. */
  fallbackQuestionType: string | null;
  fallbackSectionName: string | null;
  onAddBox: (question: Question, type: 'question' | 'option', optionIndex?: number) => void;
  onCropSave: (boxId: string) => void;
  onDeleteBox: (boxId: string) => void;
};

type Draft = {
  stem: string;
  answer: string;
  questionType: string;
  sectionName: string;
  topic: string;
  options: QuestionOption[];
};

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

/** Shows a value as rendered LaTeX by default; click to edit the raw source; blur to render again. */
function EditableLatexValue({
  value,
  onChange,
  multiline = false,
  placeholder = 'Click to edit',
}: {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  if (editing) {
    const common = {
      autoFocus: true,
      value,
      className: 'latex-edit',
      onChange: (e: { target: { value: string } }) => { onChange(e.target.value); },
      onBlur: () => { setEditing(false); },
    };
    return multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />;
  }
  return (
    <div className="latex-view" title="Click to edit raw" onClick={() => { setEditing(true); }}>
      {value.trim() ? <RenderLatex text={value} /> : <span className="muted">{placeholder}</span>}
    </div>
  );
}

/** A tiny ✨ button that AI-refines a single field's LaTeX. */
function AiButton({ busy, onClick }: { busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="btn btn--ghost btn--xs" disabled={busy} onClick={onClick} title="Fix LaTeX with AI">
      {busy ? '…' : '✨'}
    </button>
  );
}

/**
 * The editable per-question card in Verify (mirrors question-editor). Metadata + Answer + Question
 * text + Options are all editable; math fields render as LaTeX and flip to raw on click, each with a
 * per-field AI fix. Blank metadata falls back to the document's question-type / section.
 */
export function EditableQuestionCard({
  question,
  index,
  boxes,
  busyBoxIds,
  fallbackQuestionType,
  fallbackSectionName,
  onAddBox,
  onCropSave,
  onDeleteBox,
}: Props): JSX.Element {
  const update = useUpdateQuestion();
  const toDraft = (q: Question): Draft => ({
    stem: q.stem,
    answer: q.answer,
    questionType: q.questionType ?? fallbackQuestionType ?? '',
    sectionName: q.sectionName ?? fallbackSectionName ?? '',
    topic: q.topic ?? '',
    options: q.options.map((o) => ({ ...o })),
  });
  const [draft, setDraft] = useState<Draft>(() => toDraft(question));
  const [fixing, setFixing] = useState<string | null>(null);

  useEffect(() => { setDraft(toDraft(question)); }, [question]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };
  const setOption = (i: number, body: string): void => {
    setDraft((prev) => ({ ...prev, options: prev.options.map((o, j) => (j === i ? { ...o, body } : o)) }));
  };

  const refine = async (field: string, value: string, apply: (t: string) => void): Promise<void> => {
    setFixing(field);
    try {
      apply(await questionsApi.refine(value));
    } finally {
      setFixing(null);
    }
  };

  const save = (): void => {
    update.mutate({
      id: question.id,
      patch: {
        stem: draft.stem,
        answer: draft.answer,
        options: draft.options,
        questionType: draft.questionType || null,
        sectionName: draft.sectionName || null,
        topic: draft.topic || null,
      },
    });
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

  return (
    <div className="q-card">
      <div className="q-card__head">
        <span className="q-card__num">Q{index + 1}</span>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <label className="switch">
            <input type="checkbox" checked={question.isQuestionImage} onChange={(e) => { toggle('isQuestionImage', e.target.checked); }} />
            <span className="switch__track" /><span>Q image</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={question.isOptionImage} onChange={(e) => { toggle('isOptionImage', e.target.checked); }} />
            <span className="switch__track" /><span>Opt images</span>
          </label>
        </div>
      </div>

      <div className="q-meta">
        <label className="field">
          <span className="field__label">Question type</span>
          <input type="text" value={draft.questionType} onChange={(e) => { set('questionType', e.target.value); }} />
        </label>
        <label className="field">
          <span className="field__label">Section</span>
          <input type="text" value={draft.sectionName} onChange={(e) => { set('sectionName', e.target.value); }} />
        </label>
        <label className="field">
          <span className="field__label">Topic</span>
          <input type="text" value={draft.topic} onChange={(e) => { set('topic', e.target.value); }} />
        </label>
      </div>

      <div className="field">
        <span className="field__label">Answer <AiButton busy={fixing === 'answer'} onClick={() => { void refine('answer', draft.answer, (t) => { set('answer', t); }); }} /></span>
        <EditableLatexValue value={draft.answer} onChange={(v) => { set('answer', v); }} placeholder="Click to add answer" />
      </div>

      <div className="field">
        <span className="field__label">Question text <AiButton busy={fixing === 'stem'} onClick={() => { void refine('stem', draft.stem, (t) => { set('stem', t); }); }} /></span>
        <EditableLatexValue value={draft.stem} onChange={(v) => { set('stem', v); }} multiline />
      </div>

      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="field__label">Options</span>
          <button
            type="button"
            className="btn btn--xs"
            onClick={() => {
              const nextLabel = String.fromCharCode(65 + draft.options.length);
              set('options', [...draft.options, { label: nextLabel, body: '', isCorrect: false }]);
            }}
          >
            ＋ Add option
          </button>
        </div>
        {draft.options.map((option, i) => (
          <div key={i} className="q-opt-edit">
            <strong>{option.label}.</strong>
            <div style={{ flex: 1 }}>
              <EditableLatexValue value={option.body} onChange={(v) => { setOption(i, v); }} placeholder="Click to edit option" />
            </div>
            <AiButton busy={fixing === `opt${String(i)}`} onClick={() => { void refine(`opt${String(i)}`, option.body, (t) => { setOption(i, t); }); }} />
            {question.isOptionImage ? (
              <button type="button" className="btn btn--xs" onClick={() => { onAddBox(question, 'option', i); }}>Region</button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--xs" onClick={() => { set('options', draft.options.filter((_, j) => j !== i)); }}>✕</button>
          </div>
        ))}
      </div>

      {question.isQuestionImage ? (
        <div className="q-imgs">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="field__label">Question figures</span>
            <button type="button" className="btn btn--xs" onClick={() => { onAddBox(question, 'question'); }}>＋ Add region</button>
          </div>
          {qBoxes.map((box) => (
            <div key={box.id} className="q-imgs__row">
              <span className="muted">Region {box.label}</span>
              <div className="row">
                <button type="button" className="btn btn--primary btn--xs" disabled={busyBoxIds.has(box.id)} onClick={() => { onCropSave(box.id); }}>
                  {busyBoxIds.has(box.id) ? 'Saving…' : 'Crop & save'}
                </button>
                <button type="button" className="btn btn--xs" onClick={() => { onDeleteBox(box.id); }}>Remove</button>
              </div>
            </div>
          ))}
          <div className="q-imgs__grid">
            {savedQ.map((url) => (
              <div key={url} className="q-thumb">
                <img src={url} alt="question figure" />
                <button type="button" className="btn btn--ghost btn--xs" onClick={() => { removeQuestionImage(url); }}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {question.isOptionImage ? (
        <div className="q-imgs">
          <span className="field__label">Option figures</span>
          {question.options.map((option, optIdx) => {
            const oBoxes = boxes.filter((b) => b.type === 'option' && b.optionIndex === optIdx);
            const savedO = question.optionImages[optIdx];
            return (
              <div key={option.label} className="q-imgs__opt">
                <span><strong>{option.label}.</strong></span>
                {oBoxes.map((box) => (
                  <button key={box.id} type="button" className="btn btn--primary btn--xs" disabled={busyBoxIds.has(box.id)} onClick={() => { onCropSave(box.id); }}>
                    {busyBoxIds.has(box.id) ? 'Saving…' : 'Crop & save option'}
                  </button>
                ))}
                {savedO ? <div className="q-thumb"><img src={savedO} alt={`option ${option.label}`} /></div> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {update.isSuccess ? <span className="muted">Saved</span> : null}
        <button type="button" className="btn btn--primary btn--xs" disabled={update.isPending} onClick={save}>
          {update.isPending ? 'Saving…' : 'Update question'}
        </button>
      </div>
    </div>
  );
}
