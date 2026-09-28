import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CatalogQuestion, MatchData, UpdateBankText } from '@ingest/contracts';
import { aiFilledFields } from '@ingest/contracts';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { refineLatex } from '../../../shared/api/refine.js';
import {
  Badge,
  Button,
  IconCheck,
  IconEdit,
  IconFlag,
  IconPlus,
  IconSparkle,
  IconTrash,
  IconUndo,
  IconX,
  MatchTableEditor,
  QuestionView,
  Spinner,
  useToast,
} from '../../../shared/ui/index.js';
import { catalogQuestionToView } from '../lib/to-question-view.js';

/** A/B/C… label for the option at `index` (edit mode labels the draft rows). */
function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The PYQ badge text: "PYQ" plus the exam and/or year when the operator captured them. */
function pyqLabel(question: CatalogQuestion): string {
  const detail = [question.pyqExam, question.pyqYear].filter((part) => part && part.trim()).join(' ');
  return detail ? `PYQ · ${detail}` : 'PYQ';
}

/** "AI · answer, topic" plus a tooltip naming the model and when — or null when no field is AI-filled. */
function aiFilledBadge(question: CatalogQuestion): JSX.Element | null {
  const fields = aiFilledFields(question.aiFilled);
  if (fields.length === 0) return null;
  const detail = fields
    .map((field) => {
      const tag = question.aiFilled[field];
      return tag ? `${field}: ${tag.model}, ${String(Math.round(tag.confidence * 100))}% confident, ${new Date(tag.at).toLocaleDateString()}` : field;
    })
    .join('\n');
  return (
    <span title={`Filled by AI\n${detail}`}>
      {/* Outlined, with the sparkle, so it never reads as another taxonomy pill (subject uses the same tone). */}
      <Badge tone="review" dot={false} className="border border-current normal-case [&>svg]:size-3">
        <IconSparkle /> AI-filled · {fields.join(', ')}
      </Badge>
    </span>
  );
}

const FIELD_LABEL = 'flex items-center gap-1.5 text-[13px] font-medium text-ink-2';
const CARD = 'flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm';

/**
 * One published-question card. Read mode renders through the shared {@link QuestionView} — the SAME
 * component every surface uses — so a browsed question shows every field it carries (stem, figures,
 * options with their images, match table, answer, explanation) formatted identically to the verify
 * screen. Edit mode is a focused text editor for the three bank-editable fields (stem/options/answer),
 * saved via {@link onFixText}. The header keeps the operator actions: Edit, Open in Verify (reopen the
 * source), Flag, and a per-field "AI fix" (refine a field's LaTeX in place, with a one-deep undo).
 */
export function QuestionCard({
  question,
  onToggleFlag,
  onFixText,
  onDelete,
  flagPending = false,
  fixPending = false,
  deletePending = false,
}: {
  question: CatalogQuestion;
  /** Toggle this question's flag; receives the desired next state. */
  onToggleFlag: (flagged: boolean) => void;
  /** Persist an AI-fixed text field (stem/options/answer) on this question. */
  onFixText: (patch: UpdateBankText) => void;
  /** Permanently delete this question from the bank (the parent runs the danger confirm first). */
  onDelete: () => void;
  /** True while this question's flag write is in flight (disables the button). */
  flagPending?: boolean;
  /** True while this question's text fix write is in flight (disables the AI buttons). */
  fixPending?: boolean;
  /** True while this question's delete is in flight (disables the button). */
  deletePending?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  // The field currently being refined by the AI (its key), and the value each field held just before
  // its last AI fix — a one-deep, per-field undo. Keyed by 'stem' | 'answer' | 'opt{i}'.
  const [refining, setRefining] = useState<string | null>(null);
  const [preAi, setPreAi] = useState<Record<string, string>>({});
  // Inline hand-edit mode: a local draft of the text fields, edited through EditableLatexValue (same
  // widget as Verify, so the equation editor is available), saved back via the bank text-update pipeline.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    questionText: string;
    options: string[];
    answer: string;
    explanation: string;
    /** Structured match table for a matrix question; null on every other type. Edited via the table. */
    match: MatchData | null;
  }>({
    questionText: question.questionText,
    options: question.options,
    answer: question.answer ?? '',
    explanation: question.explanation ?? '',
    match: question.match,
  });

  /** Refine one field's text with AI, remember its previous value for undo, and persist the fix. */
  const runFix = async (
    key: string,
    current: string,
    toPatch: (value: string) => UpdateBankText,
  ): Promise<void> => {
    setRefining(key);
    try {
      const fixed = await refineLatex(current);
      setPreAi((prev) => ({ ...prev, [key]: current }));
      onFixText(toPatch(fixed));
    } catch (error) {
      toast.error('Could not fix with AI', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setRefining(null);
    }
  };

  /** Put a field back to the value it held before its last AI fix, and drop its undo entry. */
  const undoFix = (key: string, toPatch: (value: string) => UpdateBankText): void => {
    const previous = preAi[key];
    if (previous === undefined) return;
    onFixText(toPatch(previous));
    setPreAi((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
  };

  /** Enter hand-edit mode, seeding the draft from the current question. */
  const startEdit = (): void => {
    setDraft({
      questionText: question.questionText,
      options: question.options,
      answer: question.answer ?? '',
      explanation: question.explanation ?? '',
      match: question.match,
    });
    setEditing(true);
  };

  /** Persist only the fields that actually changed, then leave edit mode (optimistic cache shows them). */
  const saveEdit = (): void => {
    const patch: UpdateBankText = {};
    if (draft.questionText !== question.questionText) patch.questionText = draft.questionText;
    // Matrix questions may include printed A/B/C/D answer choices alongside their table. Preserve
    // those choices just like any other options instead of silently dropping their edits.
    if (JSON.stringify(draft.options) !== JSON.stringify(question.options)) {
      patch.options = draft.options;
    }
    if (draft.answer !== (question.answer ?? '')) patch.answer = draft.answer;
    const nextExplanation = draft.explanation.trim() ? draft.explanation : null;
    if (nextExplanation !== (question.explanation ?? null)) patch.explanation = nextExplanation;
    if (JSON.stringify(draft.match) !== JSON.stringify(question.match)) patch.match = draft.match;
    if (Object.keys(patch).length > 0) onFixText(patch);
    setEditing(false);
  };

  const setOption = (index: number, value: string): void => {
    setDraft((prev) => ({ ...prev, options: prev.options.map((o, j) => (j === index ? value : o)) }));
  };
  /** A matrix table is supporting structure; do not overwrite its selected printed answer option. */
  const setMatch = (next: MatchData): void => {
    setDraft((prev) => ({ ...prev, match: next }));
  };
  const addOption = (): void => { setDraft((prev) => ({ ...prev, options: [...prev.options, ''] })); };
  const removeOption = (index: number): void => {
    setDraft((prev) => ({ ...prev, options: prev.options.filter((_, j) => j !== index) }));
  };

  /** The sparkle (fix this field's LaTeX) + undo (restore the pre-AI value) pair a text field carries. */
  const fieldAi = (
    key: string,
    current: string,
    toPatch: (value: string) => UpdateBankText,
  ): JSX.Element => (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        disabled={refining === key || fixPending || current.trim() === ''}
        title="Fix this field's text with AI"
        onClick={() => { void runFix(key, current, toPatch); }}
      >
        {refining === key ? <Spinner /> : <IconSparkle />}
      </Button>
      {preAi[key] !== undefined ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={refining === key || fixPending}
          title="Undo the AI fix to this field"
          onClick={() => { undoFix(key, toPatch); }}
        >
          <IconUndo />
        </Button>
      ) : null}
    </span>
  );

  const badges = (
    <>
      {question.exam ? <Badge tone="info" dot={false}>{question.exam}</Badge> : null}
      {question.className ? <Badge tone="info" dot={false}>{question.className}</Badge> : null}
      {question.subject ? <Badge tone="review" dot={false}>{question.subject}</Badge> : null}
      {question.chapter ? <Badge tone="neutral" dot={false}>{question.chapter}</Badge> : null}
      {question.section ? <Badge tone="neutral" dot={false}>{question.section}</Badge> : null}
      {question.isPyq ? <Badge tone="progress" dot={false}>{pyqLabel(question)}</Badge> : null}
      {question.flagged ? <Badge tone="danger">Flagged</Badge> : null}
      {aiFilledBadge(question)}
    </>
  );

  if (editing) {
    return (
      <article className={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          {badges}
          <span className="flex-1" />
          <Button size="xs" variant="primary" disabled={fixPending} title="Save your edits to the bank" onClick={saveEdit}>
            <IconCheck /> {fixPending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="xs" variant="ghost" disabled={fixPending} title="Discard your edits" onClick={() => { setEditing(false); }}>
            <IconX /> Cancel
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Question</span>
          <EditableLatexValue
            value={draft.questionText}
            onChange={(v) => { setDraft((prev) => ({ ...prev, questionText: v })); }}
            multiline
            placeholder="Click to write the question"
          />
        </div>

        {draft.match ? (
          <>
            {/* A matrix edits its columns/entries/matching through the shared table (images stay in
                Verify — no source page to crop from here). The selected answer remains independent. */}
            <MatchTableEditor value={draft.match} onChange={setMatch} disabled={fixPending} allowImages={false} />
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Answer key</span>
              <div className="min-h-[38px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {draft.answer.trim() ? draft.answer : <span className="text-ink-3">No selected answer option</span>}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Options</span>
              {draft.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="font-semibold">{optionLabel(index)}.</span>
                  <div className="min-w-0 flex-1">
                    <EditableLatexValue value={option} onChange={(v) => { setOption(index, v); }} placeholder="Click to edit option" />
                  </div>
                  <Button variant="ghost" size="xs" title="Remove this option" onClick={() => { removeOption(index); }}>
                    <IconTrash />
                  </Button>
                </div>
              ))}
              <div>
                <Button size="xs" variant="ghost" onClick={addOption}>
                  <IconPlus /> Add option
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Answer</span>
              <EditableLatexValue
                value={draft.answer}
                onChange={(v) => { setDraft((prev) => ({ ...prev, answer: v })); }}
                placeholder="Click to set the answer (e.g. A, or AC)"
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Explanation</span>
          <EditableLatexValue
            value={draft.explanation}
            onChange={(v) => { setDraft((prev) => ({ ...prev, explanation: v })); }}
            multiline
            placeholder="Click to add an explanation"
          />
        </div>
      </article>
    );
  }

  return (
    <QuestionView
      model={catalogQuestionToView(question)}
      badges={badges}
      actions={
        <>
          <Button size="xs" variant="ghost" title="Edit this question's text here by hand (with the equation editor)" onClick={startEdit}>
            <IconEdit /> Edit
          </Button>
          {question.documentId && question.ingestQuestionId ? (
            <Button
              size="xs"
              variant="ghost"
              title="Open this exact question on its source page in Verify"
              onClick={() => {
                const documentId = question.documentId;
                const questionId = question.ingestQuestionId;
                if (!documentId || !questionId) return;
                const params = new URLSearchParams({
                  documentId,
                  questionId,
                  restore: '1',
                });
                void navigate(`/verify?${params.toString()}`);
              }}
            >
              Open in Verify
            </Button>
          ) : null}
          <Button
            size="xs"
            variant={question.flagged ? 'primary' : 'ghost'}
            disabled={flagPending}
            title={question.flagged ? 'Remove the flag' : 'Flag this question to edit later'}
            onClick={() => { onToggleFlag(!question.flagged); }}
          >
            <IconFlag /> {question.flagged ? 'Flagged' : 'Flag'}
          </Button>
          <Button
            size="xs"
            variant="danger"
            disabled={deletePending}
            title="Permanently delete this question from the bank"
            onClick={onDelete}
          >
            <IconTrash /> {deletePending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
      stemAction={fieldAi('stem', question.questionText, (value) => ({ questionText: value }))}
      answerAction={question.answer ? fieldAi('answer', question.answer, (value) => ({ answer: value })) : undefined}
      optionAction={(index) =>
        fieldAi(`opt${String(index)}`, question.options[index] ?? '', (value) => ({
          options: question.options.map((o, j) => (j === index ? value : o)),
        }))
      }
    />
  );
}
