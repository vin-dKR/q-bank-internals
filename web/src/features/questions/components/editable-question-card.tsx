import type { JSX } from 'react';
import { useState } from 'react';
import { KNOWN_QUESTION_TYPES, matchKeyToAnswer, type MatchData, type Question, type ReExtractedQuestion, type ReExtractSource } from '@ingest/contracts';
import { Badge, Button, Combobox, IconButton, IconCheck, IconEdit, IconFlag, IconPlus, IconScan, IconSparkle, IconUndo, IconX, Spinner, useToast } from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { MatchTableEditor } from './match-table-editor.js';
import { questionsApi } from '../api/questions.api.js';
import { useUpdateQuestion } from '../hooks/use-questions.js';
import type { QuestionDraft } from '../hooks/use-question-drafts.js';

/** A not-yet-saved crop region of this question: uploading (`saving`) or awaiting a manual retry. */
export type CardBox = { id: string; type: 'question' | 'option'; optionIndex: number; label: string; saving: boolean };

/** Which of this question's targets is armed for a rubber-band draw on the page. */
export type CardDrawTarget = { type: 'question' | 'option'; optionIndex: number };

/**
 * The togglable content groups of a question card. The Verify panel's "Show" control drives which of
 * these render, so an operator can review just what they care about (e.g. question + explanation).
 * Question figures ride with `question`; option figures with `options`; PYQ with `details`.
 */
export type CardField = 'question' | 'options' | 'answer' | 'explanation' | 'details';

/** The "Show" toggle definitions, in card order — shared with the workspace toolbar that renders them. */
export const CARD_FIELDS: readonly { field: CardField; label: string }[] = [
  { field: 'question', label: 'Question' },
  { field: 'options', label: 'Options' },
  { field: 'answer', label: 'Answer' },
  { field: 'explanation', label: 'Explanation' },
  { field: 'details', label: 'Details' },
];

/** Every field visible — the default when nothing has been toggled off. */
export const ALL_CARD_FIELDS: ReadonlySet<CardField> = new Set(CARD_FIELDS.map((f) => f.field));

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
  /**
   * Where the Answer / Explanation "re-read from page" reads from: the sibling answer / solution
   * document + this topic's page in it. Absent ⇒ that field re-reads the question's own page (the
   * fallback for a unit with no answer/solution sibling). The stem/options re-read is never redirected.
   */
  answerSource?: ReExtractSource | undefined;
  solutionSource?: ReExtractSource | undefined;
  /** Which content groups to render — the operator's "Show" selection. Defaults to all fields. */
  visibleFields?: ReadonlySet<CardField>;
  /**
   * Apply a change to this question's draft, computed from the LATEST state (not a captured snapshot).
   * Every field write folds through here so two AI re-reads finishing out of order can't clobber each
   * other — each applies onto the freshest draft the store holds.
   */
  onDraftUpdate: (updater: (prev: QuestionDraft) => QuestionDraft) => void;
  onSave: () => void;
  /** Arm (or, on the armed target, cancel) draw mode — the drawn crop then saves automatically. */
  onDrawRegion: (question: Question, type: 'question' | 'option', optionIndex?: number) => void;
  /** Retry the auto-save of a region whose upload failed. */
  onSaveBox: (boxId: string) => void;
  onDeleteBox: (boxId: string) => void;
  /** Reopen a saved crop as an adjustable box on the page so it can be moved/resized and re-saved. */
  onEditCrop?: (type: 'question' | 'option', optionIndex: number, url: string) => void;
};

function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((u) => u.trim()).filter(Boolean) : [];
}

/** The uppercase option letters marked correct in an answer string ("AC" / "A,C" / "C" → {A,C}). */
function correctLabelsFromAnswer(answer: string): Set<string> {
  return new Set(answer.toUpperCase().match(/[A-Z]/g) ?? []);
}

/**
 * Parse a matrix question's printed answer option ("A–i, B–ii, C–iii, D–iv, E–v") into a match key
 * { A:['i'], B:['ii'], … }. Pairs split on comma/semicolon; each is "<col-I label><dash><col-II label>".
 * Unparseable segments are skipped, so a stray token never poisons the whole option.
 */
function parseOptionMatching(body: string): Record<string, string[]> {
  const key: Record<string, string[]> = {};
  for (const segment of body.split(/[;,]/)) {
    const match = /^\s*([A-Za-z])\s*[-–—>:→=.)]+\s*([A-Za-z0-9]+)\s*$/.exec(segment.trim());
    if (!match) continue;
    const label = (match[1] ?? '').toUpperCase();
    const target = (match[2] ?? '').toLowerCase();
    if (label && target) key[label] = [target];
  }
  return key;
}

/** Order-independent signature of a match key, so two equal matchings compare equal regardless of order. */
function keySignature(key: Record<string, readonly string[]>): string {
  return Object.keys(key)
    .sort()
    .map((label) => `${label}:${[...(key[label] ?? [])].sort().join(',')}`)
    .join('|');
}

/** True when a printed option's matching equals the current match key (marks it as the chosen option). */
function optionMatchesKey(body: string, key: Record<string, readonly string[]>): boolean {
  const parsed = parseOptionMatching(body);
  if (Object.keys(parsed).length === 0) return false;
  return keySignature(parsed) === keySignature(key);
}

/** Serialise correct option letters to the stored multi-correct form: sorted, joined, no separator. */
function labelsToAnswer(labels: Iterable<string>): string {
  return [...labels].sort().join('');
}

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';

/** `reading` sentinel for the whole-question re-extract (distinct from the per-field keys). */
const WHOLE_REEXTRACT = 'whole';

/**
 * The click-to-mark-correct control on an option in Verify: radio-like for single_correct (round),
 * checkbox-like for multi_correct (square). The correct state reuses the green answer treatment
 * (`--color-ok`). A real button — keyboard-operable, focus ring, ≥32px — with an accessible label.
 */
function OptionCorrectToggle({
  label,
  correct,
  multi,
  onToggle,
}: {
  label: string;
  correct: boolean;
  multi: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={correct}
      aria-label={correct ? `Unmark option ${label} as correct` : `Mark option ${label} as correct`}
      title={multi ? 'Toggle this option as correct' : 'Mark this option as the correct answer'}
      onClick={onToggle}
      className={[
        'inline-flex h-8 w-8 flex-none items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
        multi ? 'rounded-md' : 'rounded-full',
        correct ? 'border-ok bg-ok-soft text-ok' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
      ].join(' ')}
    >
      {correct ? <IconCheck /> : null}
    </button>
  );
}

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
  answerSource,
  solutionSource,
  visibleFields = ALL_CARD_FIELDS,
  onDraftUpdate,
  onSave,
  onDrawRegion,
  onSaveBox,
  onDeleteBox,
  onEditCrop,
}: Props): JSX.Element {
  const show = (field: CardField): boolean => visibleFields.has(field);
  const update = useUpdateQuestion();
  const toast = useToast();
  const [fixing, setFixing] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  // The value each field held just before its last AI action replaced it — a one-deep, per-field undo.
  // An AI re-read of the answer/explanation commonly returns "" (question papers rarely print the
  // answer), which would silently wipe a good value; this lets the operator put it straight back.
  const [preAi, setPreAi] = useState<Record<string, string>>({});

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]): void => {
    onDraftUpdate((prev) => ({ ...prev, [key]: value }));
  };
  const setOption = (i: number, body: string): void => {
    onDraftUpdate((prev) => ({
      ...prev,
      options: prev.options.map((o, j) => (j === i ? { ...o, body } : o)),
    }));
  };
  // A match question edits through the structured table; the flat answer always mirrors its key.
  const setMatch = (next: MatchData): void => {
    onDraftUpdate((prev) => ({
      ...prev,
      match: next,
      answer: Object.keys(next.key).length > 0 ? matchKeyToAnswer(next.key) : prev.answer,
    }));
  };
  const seedMatch = (): void => {
    setMatch({ columns: [{ title: 'Column I', entries: [] }, { title: 'Column II', entries: [] }], key: {} });
  };
  // Click a matrix question's printed answer option to set the correct matching from it (e.g. picking
  // "A–iv, B–v, …" fills the grid A→iv, B→v, …). The flat answer mirrors the key as usual.
  const applyOptionMatching = (body: string): void => {
    const parsed = parseOptionMatching(body);
    if (Object.keys(parsed).length === 0) return;
    onDraftUpdate((prev) =>
      prev.match
        ? { ...prev, match: { columns: prev.match.columns, key: parsed }, answer: matchKeyToAnswer(parsed) }
        : prev,
    );
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

  // "Read the page again": re-extract this question from a source page image and drop ONE field of
  // the fresh result into the draft. Each field's second AI button re-reads independently (a few
  // seconds per call). `source` redirects the read to the sibling answer/solution PDF for the
  // answer/explanation fields, so those never read the question sheet; the stem/options keep reading
  // the question's own page (no source passed).
  const reExtract = async (
    field: string,
    apply: (fresh: ReExtractedQuestion) => void,
    source?: ReExtractSource,
  ): Promise<void> => {
    setReading(field);
    try {
      // Pass the type the operator currently has selected (the local draft), so a re-read honours a
      // just-changed type before the draft is saved — not the stale stored type.
      apply(await questionsApi.reExtract(question.documentId, question.id, source, draft.questionType));
    } catch (error) {
      // The page read failed (empty/truncated model reply, network, etc.). Surface it instead of
      // silently doing nothing — and critically, never touch the field, so the current value survives.
      toast.error(
        'Could not re-read the page',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setReading(null);
    }
  };

  // Re-read the WHOLE question from its page using the type the operator has selected, and replace the
  // structure at once — the fix for "a matrix/comprehension hidden in a same-type batch". Switch the
  // type in the dropdown, click this, and the model re-extracts with that type's config: a matrix
  // rebuilds its columns/match table (not garbled options); a plain type rebuilds its options. Non-empty
  // reads win; an empty answer/explanation is kept, so a question paper that prints neither never wipes.
  const reExtractWhole = async (): Promise<void> => {
    setReading(WHOLE_REEXTRACT);
    try {
      const fresh = await questionsApi.reExtract(question.documentId, question.id, undefined, draft.questionType);
      // Fold the fresh read onto the LATEST draft (not this closure's snapshot), so it survives a
      // concurrent per-field re-read finishing around the same time.
      onDraftUpdate((prev) => {
        const next: QuestionDraft = { ...prev };
        if (fresh.stem.trim() !== '') next.stem = fresh.stem;
        if (fresh.match) {
          next.match = fresh.match;
          // A matrix question keeps its printed multiple-choice options too (clickable to fill the grid).
          next.options = fresh.options;
          if (Object.keys(fresh.match.key).length > 0) next.answer = matchKeyToAnswer(fresh.match.key);
        } else if (fresh.options.length > 0) {
          next.match = null;
          next.options = fresh.options;
          if (fresh.answer.trim() !== '') next.answer = fresh.answer;
        } else if (fresh.answer.trim() !== '') {
          next.answer = fresh.answer;
        }
        if (fresh.explanation && fresh.explanation.trim() !== '') next.explanation = fresh.explanation;
        return next;
      });
      toast.toast({ tone: 'success', title: 'Re-extracted from the page', description: 'Review the updated fields, then Update to save.' });
    } catch (error) {
      toast.error(
        'Could not re-read the page',
        error instanceof Error ? error.message : 'Please try again.',
      );
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
    source?: ReExtractSource,
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
        title={source ? 'Re-read this field from the answer / solution page' : 'Re-read this question from the page'}
        icon={<IconScan />}
        onClick={() => {
          void reExtract(key, (fresh) => {
            const value = pick(fresh);
            // Only overwrite when the fresh read actually has a value for THIS field. `pick` returns a
            // string for stem/answer (never null), so an empty read would otherwise wipe the field —
            // the reported "everything resets to nothing" bug. Empty/whitespace ⇒ leave as-is.
            if (value !== null && value.trim() !== '') applyAi(key, current, value, applyText);
            else toast.toast({ tone: 'info', title: 'No update for this field', description: 'The page read did not return text for it — your current value is kept.' });
          }, source);
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
  // Flag a specific question for later attention. Saved immediately (like the image flags), separate
  // from the local-first text drafts, and carried onto the bank row when the document is published.
  const toggleFlag = (): void => {
    void update.mutateAsync({ id: question.id, patch: { flagged: !question.flagged } });
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

  // For single/multi-correct types the operator can click an option to set the correct answer, kept in
  // sync with the manual answer text: the highlight is derived from `draft.answer` (so typing updates
  // it), and a click rewrites `draft.answer` in the stored letter format (single: "C"; multi: sorted
  // joined letters like "AC"). The answer string stays the single source of truth publish reads.
  const multiCorrect = draft.questionType === 'multi_correct';
  const optionsSelectable = draft.questionType === 'single_correct' || multiCorrect;
  const correctLabels = optionsSelectable ? correctLabelsFromAnswer(draft.answer) : new Set<string>();
  const toggleCorrect = (optionLabel: string): void => {
    const upper = optionLabel.toUpperCase();
    if (multiCorrect) {
      const next = new Set(correctLabels);
      if (next.has(upper)) next.delete(upper);
      else next.add(upper);
      const optionLabels = new Set(draft.options.map((o) => o.label.toUpperCase()));
      set('answer', labelsToAnswer([...next].filter((letter) => optionLabels.has(letter))));
    } else {
      set('answer', upper);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">Q{number}</span>
        {dirty ? <Badge tone="progress">Unsaved</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="xs"
            variant={question.flagged ? 'primary' : 'ghost'}
            disabled={update.isPending}
            title={question.flagged ? 'Remove the flag' : 'Flag this question to edit later'}
            onClick={toggleFlag}
          >
            <IconFlag /> {question.flagged ? 'Flagged' : 'Flag'}
          </Button>
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

      {show('question') ? (
        <div className="flex flex-col gap-1.5">
          <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
            Question text {fieldAi('stem', draft.stem, (t) => { set('stem', t); }, (fresh) => fresh.stem)}
          </span>
          <EditableLatexValue value={draft.stem} onChange={(v) => { set('stem', v); }} multiline />
        </div>
      ) : null}

      {show('question') && question.isQuestionImage ? (
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
                <div className="flex items-center gap-1">
                  {onEditCrop ? (
                    <Button variant="ghost" size="xs" disabled={cropDisabled} onClick={() => { onEditCrop('question', 0, url); }}>
                      <IconEdit /> Edit crop
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="xs" disabled={cropDisabled} onClick={() => { removeQuestionImage(url); }}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {draft.match ? (
        <>
          {show('options') ? (
            <MatchTableEditor value={draft.match} onChange={setMatch} disabled={saving} />
          ) : null}

          {show('options') && draft.options.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Printed options — click the correct one to set the matching</span>
              {draft.options.map((option, i) => {
                const selected = draft.match !== null && optionMatchesKey(option.body, draft.match.key);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <OptionCorrectToggle
                      label={option.label}
                      correct={selected}
                      multi={false}
                      onToggle={() => { applyOptionMatching(option.body); }}
                    />
                    <strong className={selected ? 'text-ok' : undefined}>{option.label}.</strong>
                    <div className="flex-1">
                      <EditableLatexValue value={option.body} onChange={(v) => { setOption(i, v); }} placeholder="Click to edit option" />
                    </div>
                    <IconButton
                      icon={<IconX />}
                      label="Remove option"
                      size="sm"
                      onClick={() => { set('options', draft.options.filter((_, j) => j !== i)); }}
                    />
                  </div>
                );
              })}
              <div>
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
            </div>
          ) : null}

          {show('answer') ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={FIELD_LABEL}>Answer key</span>
                <Button
                  variant="ghost"
                  size="xs"
                  title="Switch this question back to plain options"
                  onClick={() => { onDraftUpdate((prev) => ({ ...prev, match: null })); }}
                >
                  Remove match table
                </Button>
              </div>
              <div className="min-h-[38px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {draft.answer.trim() ? draft.answer : <span className="text-ink-3">Set the matching above to build the key</span>}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {show('options') ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={FIELD_LABEL}>Options</span>
              <div className="flex items-center gap-2">
                {draft.questionType === 'matrix' ? (
                  <Button size="xs" variant="ghost" title="Build a match-the-column table" onClick={seedMatch}>
                    <IconPlus /> Match columns
                  </Button>
                ) : null}
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
            </div>
            {draft.options.map((option, i) => {
              const correct = optionsSelectable && correctLabels.has(option.label.toUpperCase());
              return (
              <div key={i} className="flex items-center gap-2">
                {optionsSelectable ? (
                  <OptionCorrectToggle
                    label={option.label}
                    correct={correct}
                    multi={multiCorrect}
                    onToggle={() => { toggleCorrect(option.label); }}
                  />
                ) : null}
                <strong className={correct ? 'text-ok' : undefined}>{option.label}.</strong>
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
              );
            })}
          </div>
          ) : null}

          {show('answer') ? (
          <div className="flex flex-col gap-1.5">
            <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
              Answer {fieldAi('answer', draft.answer, (t) => { set('answer', t); }, (fresh) => fresh.answer, answerSource)}
            </span>
            <EditableLatexValue value={draft.answer} onChange={(v) => { set('answer', v); }} placeholder="Click to add answer" />
          </div>
          ) : null}
        </>
      )}

      {show('explanation') ? (
        <div className="flex flex-col gap-1.5">
          <span className={`flex items-center gap-1.5 ${FIELD_LABEL}`}>
            Explanation {fieldAi('explanation', draft.explanation, (t) => { set('explanation', t); }, (fresh) => fresh.explanation ?? '', solutionSource)}
          </span>
          <EditableLatexValue value={draft.explanation} onChange={(v) => { set('explanation', v); }} multiline placeholder="Click to add explanation" />
        </div>
      ) : null}

      {show('details') ? (
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Question type</span>
          <Combobox
            value={draft.questionType}
            options={questionTypeOptions}
            placeholder="Select type…"
            onChange={(v) => { set('questionType', v); }}
          />
          <Button
            variant="ghost"
            size="xs"
            disabled={reading !== null || fixing !== null}
            title="Re-read this question from the page using the selected type — rebuilds its options or match table"
            onClick={() => { void reExtractWhole(); }}
          >
            {reading === WHOLE_REEXTRACT ? '…' : <><IconScan /> Re-extract with this type</>}
          </Button>
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
      ) : null}

      {show('details') && question.isPyq ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>PYQ exam</span>
            <Combobox
              value={draft.pyqExam}
              options={[]}
              placeholder="e.g. NEET"
              onChange={(v) => { set('pyqExam', v); }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>PYQ year</span>
            <Combobox
              value={draft.pyqYear}
              options={[]}
              placeholder="e.g. 2019"
              onChange={(v) => { set('pyqYear', v); }}
            />
          </label>
        </div>
      ) : null}

      {show('options') && question.isOptionImage ? (
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
                    <div className="flex items-center gap-1">
                      {onEditCrop ? (
                        <Button variant="ghost" size="xs" disabled={cropDisabled} onClick={() => { onEditCrop('option', optIdx, savedO); }}>
                          <IconEdit /> Edit crop
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="xs" disabled={cropDisabled} onClick={() => { removeOptionImage(optIdx); }}>Remove</Button>
                    </div>
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
