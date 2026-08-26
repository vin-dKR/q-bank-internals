import type { JSX } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CatalogQuestion, UpdateBankText } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import { refineLatex } from '../../../shared/api/refine.js';
import { Badge, Button, IconEdit, IconFlag, IconSparkle, IconUndo, Spinner, useToast } from '../../../shared/ui/index.js';

/** A/B/C… label for the option at `index`. */
function optionLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The set of correct answer tokens: eduents stores answers as a comma list of letters or numbers. */
function correctTokens(answer: string | null): Set<string> {
  if (!answer) return new Set();
  return new Set(answer.split(',').map((token) => token.trim().toUpperCase()).filter(Boolean));
}

/** An option is correct when its letter (A, B…) or its 1-based number is in the answer set. */
function isCorrect(correct: Set<string>, index: number): boolean {
  return correct.has(optionLabel(index)) || correct.has(String(index + 1));
}

/** The PYQ badge text: "PYQ" plus the exam and/or year when the operator captured them. */
function pyqLabel(question: CatalogQuestion): string {
  const detail = [question.pyqExam, question.pyqYear].filter((part) => part && part.trim()).join(' ');
  return detail ? `PYQ · ${detail}` : 'PYQ';
}

/** Only render images we can trust as absolute URLs; fix the common double-encoding (`%2520` → `%20`). */
function imageUrl(url: string): string | null {
  if (!url.startsWith('http')) return null;
  return url.replaceAll('%2520', '%20');
}

const FIELD_LABEL = 'flex items-center gap-1.5 text-[13px] font-medium text-ink-2';

/**
 * One published-question preview card: taxonomy badges, stem, options (correct highlighted), answer,
 * plus the operator actions — Edit (reopen the source in Verify), Flag (mark for later), and a per-field
 * "AI fix" that cleans a broken text field's LaTeX in place with a one-deep undo (mirroring Verify's
 * per-field AI undo). A fix persists to the bank immediately via {@link onFixText}; undo re-writes the
 * value the field held before the last AI change.
 */
export function QuestionCard({
  question,
  onToggleFlag,
  onFixText,
  flagPending = false,
  fixPending = false,
}: {
  question: CatalogQuestion;
  /** Toggle this question's flag; receives the desired next state. */
  onToggleFlag: (flagged: boolean) => void;
  /** Persist an AI-fixed text field (stem/options/answer) on this question. */
  onFixText: (patch: UpdateBankText) => void;
  /** True while this question's flag write is in flight (disables the button). */
  flagPending?: boolean;
  /** True while this question's text fix write is in flight (disables the AI buttons). */
  fixPending?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  // The field currently being refined by the AI (its key), and the value each field held just before
  // its last AI fix — a one-deep, per-field undo, matching Verify. Keyed by 'stem' | 'answer' | 'opt{i}'.
  const [refining, setRefining] = useState<string | null>(null);
  const [preAi, setPreAi] = useState<Record<string, string>>({});
  const correct = correctTokens(question.answer);
  const questionImage = question.isQuestionImage && question.questionImage
    ? imageUrl(question.questionImage)
    : null;

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

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {question.exam ? <Badge tone="info" dot={false}>{question.exam}</Badge> : null}
        {question.subject ? <Badge tone="review" dot={false}>{question.subject}</Badge> : null}
        {question.chapter ? <Badge tone="neutral" dot={false}>{question.chapter}</Badge> : null}
        {question.section ? <Badge tone="neutral" dot={false}>{question.section}</Badge> : null}
        {question.isPyq ? <Badge tone="progress" dot={false}>{pyqLabel(question)}</Badge> : null}
        {question.flagged ? <Badge tone="danger">Flagged</Badge> : null}
        <span className="flex-1" />
        {question.documentId ? (
          <Button
            size="xs"
            variant="ghost"
            title="Open this question's source in Verify to edit it"
            onClick={() => { void navigate(`/verify?documentId=${encodeURIComponent(question.documentId as string)}&restore=1`); }}
          >
            <IconEdit /> Edit
          </Button>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-3"
            title="This question isn't linked to an ingest session (published before source tracking, or created outside ingest), so it can't be reopened in Verify."
          >
            <IconEdit /> Not from a session
          </span>
        )}
        <Button
          size="xs"
          variant={question.flagged ? 'primary' : 'ghost'}
          disabled={flagPending}
          title={question.flagged ? 'Remove the flag' : 'Flag this question to edit later'}
          onClick={() => { onToggleFlag(!question.flagged); }}
        >
          <IconFlag /> {question.flagged ? 'Flagged' : 'Flag'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>
          Question {fieldAi('stem', question.questionText, (value) => ({ questionText: value }))}
        </span>
        <div className="text-sm leading-relaxed text-ink">
          <RenderLatex text={question.questionText} />
        </div>
      </div>

      {questionImage ? (
        <img
          src={questionImage}
          alt="Question figure"
          className="max-h-72 w-auto max-w-full rounded-lg border border-line object-contain"
        />
      ) : null}

      {question.isOptionImage ? (
        <div className="grid grid-cols-2 gap-3">
          {question.optionImages.map((url, index) => {
            const src = imageUrl(url);
            return src ? (
              <figure key={index} className="flex flex-col gap-1.5">
                <figcaption className="text-xs font-semibold text-ink-2">{optionLabel(index)}.</figcaption>
                <img
                  src={src}
                  alt={`Option ${optionLabel(index)}`}
                  className="max-h-48 w-auto max-w-full rounded-lg border border-line object-contain"
                />
              </figure>
            ) : null;
          })}
        </div>
      ) : question.options.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {question.options.map((option, index) => (
            <li
              key={index}
              className={
                isCorrect(correct, index)
                  ? 'flex items-center gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2 text-sm text-ink'
                  : 'flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-2'
              }
            >
              <span className="font-semibold">{optionLabel(index)}.</span>
              <span className="min-w-0 flex-1">
                <RenderLatex text={option} />
              </span>
              {fieldAi(
                `opt${String(index)}`,
                option,
                (value) => ({ options: question.options.map((o, j) => (j === index ? value : o)) }),
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {question.answer ? (
        <div className="flex items-center gap-1.5">
          <Badge tone="success">
            Answer:&nbsp;<RenderLatex text={question.answer} />
          </Badge>
          {fieldAi('answer', question.answer, (value) => ({ answer: value }))}
        </div>
      ) : null}
    </article>
  );
}
