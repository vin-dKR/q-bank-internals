import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  parseMatchKey,
  synthesizeMatrixChoiceOptions,
  type MatchData,
  type Question,
  type QuestionOption,
  type ReExtractedQuestion,
  type ReExtractSource,
} from '@ingest/contracts';
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  CropImageButton,
  IconButton,
  IconCheck,
  IconChevronDown,
  IconFlag,
  IconPlus,
  IconScan,
  IconSparkle,
  IconTrash,
  IconUndo,
  IconX,
  MatchTableEditor,
  Spinner,
  useToast,
} from '../../../shared/ui/index.js';
import { EditableLatexValue } from '../../../shared/lib/latex.js';
import { toQuestionTypeOptions, useDictionary } from '../../taxonomy/index.js';
import { questionsApi } from '../api/questions.api.js';
import { useSetQuestionImageMode, useUpdateQuestion } from '../hooks/use-questions.js';
import type { QuestionDraft } from '../hooks/use-question-drafts.js';

/** A not-yet-saved crop region of this question: uploading (`saving`) or awaiting a manual retry. */
export type CardBox = {
  id: string;
  type: 'question' | 'option';
  optionIndex: number;
  label: string;
  saving: boolean;
};

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
  /** Render flattened (no card border/background/padding) as a section inside a comprehension group card. */
  nested?: boolean;
  /** Optional selection for creating a new comprehension group; rendered in the card header. */
  selection?: { checked: boolean; onChange: () => void } | undefined;
  /** Session-level context, surfaced read-only so the operator sees where this question is filed. */
  exam?: string | null;
  subject?: string | null;
  /**
   * Where the Answer / Explanation "re-read from page" reads from: the sibling answer / solution
   * document + this topic's page in it. Absent ⇒ that field re-reads the question's own page (the
   * fallback for a unit with no answer/solution sibling). The stem/options re-read is never redirected.
   */
  answerSource?: ReExtractSource | undefined;
  solutionSource?: ReExtractSource | undefined;
  /** Inline papers keep answer/solution material on the question canvas, so their crop controls stay available. */
  inlineAnswers?: boolean;
  /**
   * Apply a change to this question's draft, computed from the LATEST state (not a captured snapshot).
   * Every field write folds through here so two AI re-reads finishing out of order can't clobber each
   * other — each applies onto the freshest draft the store holds.
   */
  onDraftUpdate: (updater: (prev: QuestionDraft) => QuestionDraft) => void;
  onSave: () => void;
  /** Remove this question entirely (and its published bank copy) — the workspace confirms first. */
  onDelete: () => void;
  /**
   * Arm a one-shot image crop from a source page and resolve with the uploaded URL (or `null` when the
   * operator cancels). `source` picks the page: `'question'` (the main canvas, e.g. a match entry),
   * `'answer'` (the sibling answer-key pane), or `'solution'` (the worked-solution pane).
   */
  onRequestCrop: (
    questionId: string,
    source: 'question' | 'answer' | 'solution',
    replaceUrl?: string,
  ) => Promise<string | null>;
  /** Arm (or, on the armed target, cancel) draw mode — the drawn crop then saves automatically. */
  onDrawRegion: (question: Question, type: 'question' | 'option', optionIndex?: number) => void;
  /** Retry the auto-save of a region whose upload failed. */
  onSaveBox: (boxId: string) => void;
  onDeleteBox: (boxId: string) => void;
};

function splitUrls(value: string | null): string[] {
  return value
    ? value
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    : [];
}

type LabeledOption = Pick<
  QuestionDraft['options'][number],
  'label' | 'body' | 'isCorrect' | 'generated'
>;

/**
 * A displayed label is the canonical identity of a choice. Do not infer a choice from arbitrary
 * letters in the answer text: that made an answer of "False" select option A, and discarded the
 * printed labels on numbered/Roman/custom-choice papers.
 */
function optionLabelKey(value: string): string {
  return value
    .trim()
    .replace(/^[\s([{]+/, '')
    .replace(/[\s)\]}.:]+$/, '')
    .toLocaleUpperCase();
}

/** Return a truth value only when the entire choice is a truth token (including simple LaTex text). */
function truthValue(value: string): 'true' | 'false' | null {
  const normalized = value
    .trim()
    .replace(/\\(?:text|mathrm|operatorname)\s*\{([^{}]*)\}/g, '$1')
    .replace(/[()[\]{}.,;:]/g, '')
    .trim()
    .toLocaleLowerCase();
  if (normalized === 'true' || normalized === 't') return 'true';
  if (normalized === 'false' || normalized === 'f') return 'false';
  return null;
}

/** Resolve an answer token to the actual option label, with legacy positional aliases as a fallback. */
function resolveOptionLabel(token: string, options: readonly LabeledOption[]): string | null {
  const key = optionLabelKey(token);
  if (!key) return null;
  const exact = options.find((option) => optionLabelKey(option.label) === key)?.label;
  if (exact) return exact;

  // Older extracted rows sometimes store A/B/C/D for a paper whose printed choices are numbered,
  // or the inverse. Only use this after trying the actual label, so a real "1" or "A" is never
  // remapped to a different option.
  if (/^\d+$/.test(key)) {
    const index = Number(key) - 1;
    return Number.isSafeInteger(index) && index >= 0 ? (options[index]?.label ?? null) : null;
  }
  if (/^[A-Z]$/.test(key)) {
    const index = key.charCodeAt(0) - 65;
    return index >= 0 ? (options[index]?.label ?? null) : null;
  }
  return null;
}

/**
 * Resolve the option labels named by an answer string. Exact printed labels always win; compact
 * multi-correct notation ("AC") is expanded only when every character is an actual label. This
 * preserves Roman, numeric, and multi-character labels without treating prose as a choice key.
 */
function correctLabelsFromAnswer(answer: string, options: readonly LabeledOption[]): Set<string> {
  const value = answer.trim();
  if (!value)
    return new Set(options.filter((option) => option.isCorrect).map((option) => option.label));
  // A direct matrix mapping is not an instruction to select a printed answer option.
  if (/(?:→|->|=)/.test(value)) return new Set();

  const truth = truthValue(value);
  if (truth) {
    const fromBody = options.find((option) => truthValue(option.body) === truth)?.label;
    if (fromBody) return new Set([fromBody]);
  }

  const direct = resolveOptionLabel(value, options);
  if (direct) return new Set([direct]);

  const labels = new Set<string>();
  for (const token of value.split(/[\s,;/&+]+/).filter(Boolean)) {
    const resolved = resolveOptionLabel(token, options);
    if (resolved) {
      labels.add(resolved);
      continue;
    }
    // `AC` means A and C only when A and C are both actual one-character choices. It must not
    // split `III`, `10`, or a custom label that did not match exactly above.
    if (/^[A-Za-z0-9]{2,}$/.test(token)) {
      const expanded = (token.match(/[A-Za-z0-9]/g) ?? []).map((character) =>
        resolveOptionLabel(character, options),
      );
      if (expanded.every((label): label is string => label !== null)) {
        expanded.forEach((label) => labels.add(label));
      }
    }
  }
  return labels;
}

/**
 * Parse a matrix question's printed answer option into a match key { A:['p','t'], B:['q'], … }. Two
 * printed dialects occur and BOTH must round-trip: one-to-one with comma-separated pairs
 * ("A-p, B-q, C-r, D-s") and one-to-many with semicolon-separated pairs and comma-separated targets
 * ("A-p,t; B-q,u"). We split on every pair separator (comma / semicolon / newline), then treat a segment
 * that opens with "<label><sep>" as starting a new pair and any bare segment after it (a lone target like
 * the "t" in "A-p,t") as ANOTHER target for the pair that preceded it — so a one-to-many matching keeps
 * all its targets instead of silently dropping them. This is deliberately a best-effort convenience:
 * choosing a printed option must still work when the option uses an unfamiliar visual/table pattern.
 * Unparseable segments are skipped, so a stray token never poisons the whole option.
 */
function parseOptionMatching(
  body: string,
  knownTargetLabels?: readonly string[],
): Record<string, string[]> {
  const key: Record<string, string[]> = {};
  let current: string | null = null;
  const parseTargets = (token: string): string[] =>
    parseMatchKey(`X → ${token}`, knownTargetLabels).X ?? [];
  for (const segment of body.split(/[;,\n]/)) {
    const token = segment.trim();
    if (!token) continue;
    const pair = /^([A-Za-z0-9]+)\s*[-–—>:→=.)]+\s*([A-Za-z0-9]+)$/.exec(token);
    if (pair) {
      current = (pair[1] ?? '').trim();
      key[current] = parseTargets((pair[2] ?? '').trim());
    } else if (current !== null && /^[A-Za-z0-9]+$/.test(token)) {
      const targets = key[current] ?? [];
      targets.push(...parseTargets(token));
      key[current] = targets;
    }
  }
  return key;
}

function targetLabelsForMatch(match: MatchData): string[] {
  return match.columns.slice(1).flatMap((column) => column.entries.map((entry) => entry.label));
}

/** Order/case-insensitive identity for a matrix mapping represented in an answer-choice body. */
function matrixKeySignature(key: Record<string, readonly string[]>): string {
  return Object.entries(key)
    .filter(([, targets]) => targets.length > 0)
    .map(
      ([source, targets]) =>
        `${optionLabelKey(source)}:${[...targets].map(optionLabelKey).sort().join(',')}`,
    )
    .sort()
    .join('|');
}

function optionMatchesMatrixKey(
  option: Pick<QuestionOption, 'body'>,
  match: MatchData,
): boolean {
  const parsed = parseOptionMatching(option.body, targetLabelsForMatch(match));
  return Object.keys(parsed).length > 0 && matrixKeySignature(parsed) === matrixKeySignature(match.key);
}

function isGeneratedMatrixOption(option: Pick<QuestionOption, 'generated'>): boolean {
  return option.generated === true;
}

/** The selected choice is normally `answer`; old rows sometimes only retained `isCorrect`. */
function selectedMatrixOptionIndex(options: readonly QuestionOption[], answer: string): number {
  const selected = resolveOptionLabel(answer, options);
  if (selected) {
    const index = options.findIndex(
      (option) => optionLabelKey(option.label) === optionLabelKey(selected),
    );
    if (index >= 0) return index;
  }
  return options.findIndex((option) => option.isCorrect);
}

type MatrixChoiceState = Pick<QuestionDraft, 'options' | 'answer'>;

/**
 * Keep a matrix's selected answer choice honest after the table changes. The synthesis helper only
 * acts on a complete, unambiguous table; source/manual choices are retained verbatim. A generated
 * selected row is replaceable, while a source/manual selected row gets a new generated companion so
 * a teacher's wording is never silently overwritten.
 */
function synchronizeMatrixChoiceState(
  options: readonly QuestionOption[],
  answer: string,
  match: MatchData,
): MatrixChoiceState {
  const synthesis = synthesizeMatrixChoiceOptions(match);
  if (synthesis.status === 'blocked') {
    // An incomplete table must not leave a generated "correct" answer looking trustworthy. Printed
    // answer choices, however, remain source evidence and are deliberately preserved.
    if (options.length > 0 && options.every(isGeneratedMatrixOption)) {
      return { options: options.map((option) => ({ ...option, isCorrect: false })), answer: '' };
    }
    return { options: [...options], answer };
  }

  // A pristine generated set is disposable as a unit. Rebuild all distractors as well as the correct
  // choice so a manual table edit never leaves choices derived from the old relationship behind.
  if (options.length === 0 || options.every(isGeneratedMatrixOption)) {
    return { options: synthesis.options, answer: synthesis.answer };
  }

  const matchingIndex = options.findIndex((option) => optionMatchesMatrixKey(option, match));
  const matchingOption = matchingIndex >= 0 ? options[matchingIndex] : undefined;
  if (matchingOption) {
    const selected = matchingOption;
    return { options: withCorrectOptions(options, [selected.label]), answer: selected.label };
  }

  const selectedIndex = selectedMatrixOptionIndex(options, answer);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  if (selectedOption && isGeneratedMatrixOption(selectedOption)) {
    const selected = selectedOption;
    return {
      options: options.map((option, index) =>
        index === selectedIndex
          ? { ...option, body: synthesis.correctMapping, isCorrect: true, generated: true }
          : { ...option, isCorrect: false },
      ),
      answer: selected.label,
    };
  }

  // Existing source/manual choices remain untouched. Add the exact custom map as a labelled generated
  // choice so every completed table still has one unambiguously correct selectable answer.
  const label = nextOptionLabel(options);
  const generated: QuestionOption = {
    label,
    body: synthesis.correctMapping,
    isCorrect: true,
    generated: true,
  };
  return { options: [...withCorrectOptions(options, []), generated], answer: label };
}

/**
 * Choosing an already visible matrix option is deliberately the inverse of editing the matching
 * grid: the option is the source of truth for this one action. Keep the exact rendered choice set
 * (including its order and generated distractors), mark the clicked row correct, and reflect that
 * row's mapping back into the grid. Calling `synchronizeMatrixChoiceState` here would regenerate
 * the set and can move the clicked D choice to another label before the user sees it selected.
 *
 * Grid/table edits still go through `setMatch` → `synchronizeMatrixChoiceState`, which is the
 * intentional place to rebuild/reshuffle generated choices from a newly authored mapping.
 */
function selectExistingMatrixOption(
  draft: QuestionDraft,
  label: string,
  body: string,
): QuestionDraft {
  const selectedLabel = resolveOptionLabel(label, draft.options) ?? label;
  // The click handler's body comes from a render snapshot. Resolve it again from the latest draft
  // so a fast text edit followed by a click cannot put an older mapping back into the table.
  const selectedBody =
    draft.options.find((option) => optionLabelKey(option.label) === optionLabelKey(selectedLabel))
      ?.body ?? body;
  const parsed = parseOptionMatching(
    selectedBody,
    draft.match ? targetLabelsForMatch(draft.match) : undefined,
  );
  const match =
    draft.match && Object.keys(parsed).length > 0
      ? { ...draft.match, key: parsed }
      : draft.match;

  return {
    ...draft,
    match,
    answer: selectedLabel,
    options: withCorrectOptions(draft.options, [selectedLabel]),
  };
}

function matrixChoiceSetupCopy(reason: string | undefined): string {
  switch (reason) {
    case 'missing_columns':
      return 'Add at least two match columns before answer choices can be generated.';
    case 'missing_entries':
      return 'Add entries to every match column before answer choices can be generated.';
    case 'ambiguous_labels':
      return 'Make every source and target label unique before answer choices can be generated.';
    case 'incomplete_key':
      return 'Choose at least one correct target for every first-column entry to generate answer choices.';
    case 'invalid_key':
      return 'Use simple unique row/target labels and complete the matching to generate answer choices.';
    default:
      return 'Complete the matching table to generate answer choices.';
  }
}

/**
 * Serialise selected labels in their printed/source order. Keep compact A/C-style answers for
 * one-character labels, but delimit Roman, numeric, and custom labels so nothing is lost or
 * ambiguously merged (for example, `I, III` rather than `IIII`).
 */
function labelsToAnswer(labels: Iterable<string>, options: readonly LabeledOption[]): string {
  const selected = new Set([...labels].map(optionLabelKey));
  const ordered = options
    .map((option) => option.label)
    .filter((label) => selected.has(optionLabelKey(label)));
  return ordered.every((label) => /^[A-Za-z0-9]$/.test(label))
    ? ordered.join('')
    : ordered.join(', ');
}

function withCorrectOptions(
  options: readonly LabeledOption[],
  labels: Iterable<string>,
): LabeledOption[] {
  const selected = new Set([...labels].map(optionLabelKey));
  return options.map((option) => ({
    ...option,
    isCorrect: selected.has(optionLabelKey(option.label)),
  }));
}

/**
 * The next unused uppercase option label (A, B, C, …) for an "Add option" click. Derived from the labels
 * already present rather than the count, so adding after a mid-list removal (e.g. [A, C] → add) fills the
 * gap ("B") instead of duplicating an existing label ("C").
 */
function nextOptionLabel(options: readonly { label: string }[]): string {
  const taken = new Set(options.map((option) => option.label.trim().toUpperCase()));
  for (let i = 0; i < 26; i += 1) {
    const label = String.fromCharCode(65 + i);
    if (!taken.has(label)) return label;
  }
  return String.fromCharCode(65 + options.length);
}

const FIELD_LABEL = 'text-[13px] font-medium text-ink-2';
type OptionLayout = 'list' | 'two' | 'three' | 'four';
type ImageModeKey = 'isQuestionImage' | 'isOptionImage';
type ChoiceProfile = 'choices' | 'matrix' | 'response';
const OPTION_LAYOUTS: readonly {
  value: OptionLayout;
  label: string;
  title: string;
  maxColumns: number;
}[] = [
  { value: 'list', label: 'List', title: 'Show one full-width option per row', maxColumns: 1 },
  { value: 'two', label: '2', title: 'Show up to two option cards per row', maxColumns: 2 },
  { value: 'three', label: '3', title: 'Show up to three option cards per row', maxColumns: 3 },
  { value: 'four', label: '4', title: 'Show up to four option cards per row', maxColumns: 4 },
];

/**
 * The editor must follow the question's behaviour, not merely whether the extractor happened to
 * return an `options` array. A stale four-choice array on an integer question is data to replace on
 * re-extract, not a reason to render a multiple-choice editor for the teacher.
 */
function choiceProfile(type: string | null, optionCount: number): ChoiceProfile {
  if (type === 'matrix') return 'matrix';
  if (
    type === 'single_correct' ||
    type === 'multi_correct' ||
    type === 'assertion_reason' ||
    type === 'true_false'
  ) {
    return 'choices';
  }
  if (
    type === 'integer' ||
    type === 'fill_blank' ||
    type === 'subjective' ||
    type === 'comprehension'
  ) {
    return 'response';
  }
  // Legacy/custom types retain extracted choices when they exist, but do not manufacture an empty
  // options section for a free-response question whose behaviour is unknown to this build.
  return optionCount > 0 ? 'choices' : 'response';
}

function answerCopy(type: string | null): { label: string; placeholder: string } {
  switch (type) {
    case 'integer':
      return { label: 'Integer answer', placeholder: 'Click to enter the integer answer' };
    case 'fill_blank':
      return { label: 'Expected fill', placeholder: 'Click to enter the expected fill' };
    case 'true_false':
      return { label: 'Truth value', placeholder: 'Click to enter True or False' };
    case 'subjective':
      return { label: 'Expected answer', placeholder: 'Click to add the expected answer' };
    case 'comprehension':
      return { label: 'Sub-question answer', placeholder: 'Click to add the answer' };
    default:
      return { label: 'Answer', placeholder: 'Click to add answer' };
  }
}

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
        correct
          ? 'border-ok bg-ok-soft text-ok'
          : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
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
    <Button
      variant="ghost"
      size="xs"
      disabled={busy || disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {busy ? '…' : icon}
    </Button>
  );
}

/** Compact figure preview: adjustment happens on the source canvas, so only destructive removal lives here. */
function FigureThumbnail({
  src,
  alt,
  onRemove,
  disabled = false,
}: {
  src: string;
  alt: string;
  onRemove: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="group relative w-28 flex-none rounded-lg border border-line bg-white p-1.5">
      <img src={src} alt={alt} className="h-20 w-full rounded object-contain" />
      <button
        type="button"
        aria-label={`Remove ${alt}`}
        title={`Remove ${alt}`}
        disabled={disabled}
        onClick={onRemove}
        className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-200 bg-white text-bad shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconX />
      </button>
    </div>
  );
}

/** A quiet but unmistakable divider between the Verify editor's major jobs. */
function EditorSectionHeader({
  number,
  title,
  tone = 'question',
  id,
  actions,
}: {
  number: string;
  title: string;
  tone?: 'question' | 'options' | 'answer' | 'explanation';
  id?: string;
  actions?: JSX.Element | null | undefined;
}): JSX.Element {
  const toneClasses = {
    question: 'bg-brand-soft text-q',
    options: 'bg-surface-2 text-ink-2',
    answer: 'bg-warn-soft text-warn',
    explanation: 'bg-ok-soft text-s',
  }[tone];
  return (
    <div className="flex min-h-7 items-center justify-between gap-2 border-b border-line pb-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${toneClasses}`}
        >
          {number}
        </span>
        <h3 id={id} className="text-sm font-semibold text-ink">
          {title}
        </h3>
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">{actions}</div>
      ) : null}
    </div>
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
  nested = false,
  selection,
  exam,
  subject,
  answerSource,
  solutionSource,
  inlineAnswers = false,
  onDraftUpdate,
  onSave,
  onDelete,
  onRequestCrop,
  onDrawRegion,
  onSaveBox,
  onDeleteBox,
}: Props): JSX.Element {
  const update = useUpdateQuestion();
  const setImageMode = useSetQuestionImageMode();
  const toast = useToast();
  // Crop buttons can remain open while another image is removed. Always derive image-list patches
  // from the latest cached row, not the render that first opened the crop dialog, so one action
  // cannot put a previously removed figure back into a multi-image answer/explanation gallery.
  const latestQuestion = useRef(question);
  latestQuestion.current = question;
  const [fixing, setFixing] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  // Four-choice papers are most often read as a 2 × 2 block. Other views are explicit and render
  // exactly the requested number of columns (rather than being silently capped by panel width).
  const [optionLayout, setOptionLayout] = useState<OptionLayout>('two');
  const [imageFlags, setImageFlags] = useState({
    isQuestionImage: question.isQuestionImage,
    isOptionImage: question.isOptionImage,
  });
  const [explanationOpen, setExplanationOpen] = useState(() =>
    Boolean(draft.explanation.trim() || question.explanationImages.length > 0),
  );
  // Keep the image controls local-first until their background writes finish. This prevents an
  // unrelated question refresh (for example a crop upload) from making a just-clicked checkbox
  // flash back to its old state.
  const [pendingImageWrites, setPendingImageWrites] = useState<Record<ImageModeKey, number>>({
    isQuestionImage: 0,
    isOptionImage: 0,
  });
  // Reset local interaction bookkeeping when this card receives a different question.
  useEffect(() => {
    setPendingImageWrites({ isQuestionImage: 0, isOptionImage: 0 });
    setImageFlags({
      isQuestionImage: question.isQuestionImage,
      isOptionImage: question.isOptionImage,
    });
    setExplanationOpen(Boolean(draft.explanation.trim() || question.explanationImages.length > 0));
  }, [question.id]);
  // After local writes are settled, accept server/cache updates such as an import or a crop save.
  // During a local write, retain the instant state shown to the operator instead.
  useEffect(() => {
    setImageFlags((current) => ({
      isQuestionImage:
        pendingImageWrites.isQuestionImage > 0 ? current.isQuestionImage : question.isQuestionImage,
      isOptionImage:
        pendingImageWrites.isOptionImage > 0 ? current.isOptionImage : question.isOptionImage,
    }));
  }, [
    pendingImageWrites.isOptionImage,
    pendingImageWrites.isQuestionImage,
    question.isOptionImage,
    question.isQuestionImage,
  ]);
  // A real extracted explanation (text or a figure) should never be hidden. Blank explanations start
  // collapsed, but any later extraction or image crop opens the section so the new content is visible.
  useEffect(() => {
    if (draft.explanation.trim() || question.explanationImages.length > 0) setExplanationOpen(true);
  }, [draft.explanation, question.explanationImages.length]);
  // The value each field held just before its last AI action replaced it — a one-deep, per-field undo.
  // An AI re-read of the answer/explanation commonly returns "" (question papers rarely print the
  // answer), which would silently wipe a good value; this lets the operator put it straight back.
  const [preAi, setPreAi] = useState<Record<string, string>>({});

  // Every metadata dropdown draws its options from the all-masters dictionaries only. React-query
  // dedupes these by queryKey, so N cards on screen share ONE request per dimension. Topics are scoped
  // to the question's chapter (resolved name → id via the chapter dictionary); the closed questionType
  // dimension keeps the behavior SLUG as its stored value (label = the master's display name).
  const questionTypeDict = useDictionary('questionType', {});
  const levelDict = useDictionary('level', {});
  const sectionDict = useDictionary('section', {});
  const examDict = useDictionary('exam', {});
  const chapterDict = useDictionary('chapter', {});
  const chapterId = chapterDict.data?.entries.find(
    (entry) => entry.name.trim().toLowerCase() === question.path.chapter.trim().toLowerCase(),
  )?.id;
  const topicDict = useDictionary('topic', chapterId ? { chapterId } : {}, Boolean(chapterId));

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]): void => {
    onDraftUpdate((prev) => ({ ...prev, [key]: value }));
  };
  const setOption = (i: number, body: string): void => {
    onDraftUpdate((prev) => ({
      ...prev,
      options: prev.options.map((option, index) => {
        if (index !== i || option.body === body) return option;
        // A hand edit becomes explicit custom content whether it began as generated or printed.
        // `false` is deliberately distinct from absent (untouched source text) and true (replaceable
        // deterministic text), so the UI can explain exactly what will be preserved on a table edit.
        return { ...option, body, generated: false };
      }),
    }));
  };
  // A completed matrix always has a selectable canonical answer choice. The shared synthesis helper
  // proves the table/key is complete before generating anything, and never replaces source choices.
  const setMatch = (next: MatchData): void => {
    onDraftUpdate((prev) => {
      const synced = synchronizeMatrixChoiceState(prev.options, prev.answer, next);
      return { ...prev, match: next, ...synced };
    });
  };
  const seedMatch = (): void => {
    setMatch({
      columns: [
        { title: 'Column I', entries: [] },
        { title: 'Column II', entries: [] },
      ],
      key: {},
    });
  };
  // Existing sessions can predate generated matrix choices. As soon as their saved table contains a
  // complete unambiguous key, create the deterministic choice set locally so opening Verify is enough
  // to repair the legacy direct-response shape. Incomplete tables remain untouched and show guidance.
  useEffect(() => {
    if (!draft.match || draft.options.length > 0) return;
    if (synthesizeMatrixChoiceOptions(draft.match).status !== 'generated') return;
    onDraftUpdate((prev) => {
      if (!prev.match || prev.options.length > 0) return prev;
      const synced = synchronizeMatrixChoiceState(prev.options, prev.answer, prev.match);
      return { ...prev, ...synced };
    });
  }, [draft.match, draft.options.length, onDraftUpdate, question.id]);
  /** Keep the draft structurally valid when the teacher changes its type before re-extracting it. */
  const setQuestionType = (questionType: string): void => {
    onDraftUpdate((prev) => {
      const previousProfile = choiceProfile(prev.questionType, prev.options.length);
      const nextProfile = choiceProfile(questionType, prev.options.length);
      if (nextProfile === 'response') {
        return { ...prev, questionType, options: [], match: null };
      }
      if (nextProfile === 'matrix') {
        return { ...prev, questionType, match: previousProfile === 'matrix' ? prev.match : null };
      }
      return { ...prev, questionType, match: null };
    });
  };
  // A printed/generated matrix choice is the canonical student answer. When its text is a parseable
  // matching, reflect it in the table too — but do not regenerate choices during this inverse path.
  // The visible row the teacher clicked must remain that exact selected row (e.g. D stays D).
  const selectMatrixOption = (label: string, body: string): void => {
    onDraftUpdate((prev) => {
      return selectExistingMatrixOption(prev, label, body);
    });
  };
  /**
   * Generated choice sets stay complete: deleting one of an untouched all-generated set simply
   * rebuilds the deterministic four choices. Editing a generated row first turns it into manual
   * content, after which removal behaves like any teacher-authored choice.
   */
  const removeMatrixOption = (index: number): void => {
    onDraftUpdate((prev) => {
      const remaining = prev.options.filter((_, optionIndex) => optionIndex !== index);
      if (!prev.match) return { ...prev, options: remaining };
      const wasEntireGeneratedSet =
        prev.options.length > 0 && prev.options.every(isGeneratedMatrixOption);
      if (wasEntireGeneratedSet) {
        const synthesis = synthesizeMatrixChoiceOptions(prev.match);
        if (synthesis.status === 'generated') {
          return { ...prev, options: synthesis.options, answer: synthesis.answer };
        }
      }
      const nextAnswer = selectedMatrixOptionIndex(remaining, prev.answer) >= 0 ? prev.answer : '';
      const synced = synchronizeMatrixChoiceState(remaining, nextAnswer, prev.match);
      return { ...prev, ...synced };
    });
  };
  /** Clear structure without leaking synthetic rows into a newly blank matrix. */
  const clearMatrixTable = (): void => {
    onDraftUpdate((prev) => {
      const options = prev.options.filter((option) => !isGeneratedMatrixOption(option));
      const selected = selectedMatrixOptionIndex(options, prev.answer);
      return {
        ...prev,
        match: null,
        options,
        answer: selected >= 0 ? (options[selected]?.label ?? '') : '',
      };
    });
  };

  /** Apply an AI-produced value to a field, remembering the previous value so it can be undone. */
  const applyAi = (
    key: string,
    previous: string,
    next: string,
    apply: (t: string) => void,
  ): void => {
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

  const refine = async (
    field: string,
    value: string,
    apply: (t: string) => void,
  ): Promise<void> => {
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
      apply(
        await questionsApi.reExtract(question.documentId, question.id, source, draft.questionType),
      );
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
      const fresh = await questionsApi.reExtract(
        question.documentId,
        question.id,
        undefined,
        draft.questionType,
      );
      // Fold the fresh read onto the LATEST draft (not this closure's snapshot), so it survives a
      // concurrent per-field re-read finishing around the same time.
      onDraftUpdate((prev) => {
        const next: QuestionDraft = { ...prev };
        if (fresh.stem.trim() !== '') next.stem = fresh.stem;
        const profile = choiceProfile(next.questionType, fresh.options.length);
        if (profile === 'matrix') {
          // A matrix keeps its structured table plus source choices. If the page had no choice panel,
          // the shared deterministic synthesis creates one only after it has validated the whole key.
          next.match = fresh.match;
          if (fresh.match) {
            const synced = synchronizeMatrixChoiceState(fresh.options, fresh.answer, fresh.match);
            next.options = synced.options;
            next.answer = synced.answer;
          } else {
            next.options = fresh.options;
            if (fresh.answer.trim() !== '') next.answer = fresh.answer;
          }
        } else {
          next.match = null;
          // Explicit free-response profiles must never retain old multiple-choice rows just because
          // the re-extractor correctly returned an empty array.
          next.options = profile === 'choices' ? fresh.options : [];
          if (fresh.answer.trim() !== '') next.answer = fresh.answer;
        }
        if (fresh.explanation && fresh.explanation.trim() !== '')
          next.explanation = fresh.explanation;
        return next;
      });
      toast.toast({
        tone: 'success',
        title: 'Re-extracted from the page',
        description: 'Review the updated fields, then Update to save.',
      });
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
    /**
     * Most field reads replace one text value. A matrix answer read is different: the server may
     * have completed its structured key and synthesized the matching choices alongside `answer`.
     * Let that caller install the coherent result atomically before the generic text fallback runs.
     */
    applyStructuredResult?: (fresh: ReExtractedQuestion) => boolean,
  ): JSX.Element => (
    <>
      <AiButton
        busy={fixing === key}
        disabled={reading === key}
        title="Fix LaTeX with AI"
        icon={<IconSparkle />}
        onClick={() => {
          void refine(key, current, applyText);
        }}
      />
      <AiButton
        busy={reading === key}
        disabled={fixing === key}
        title={
          source
            ? 'Re-read this field from the answer / solution page'
            : 'Re-read this question from the page'
        }
        icon={<IconScan />}
        onClick={() => {
          void reExtract(
            key,
            (fresh) => {
              if (applyStructuredResult?.(fresh)) return;
              const value = pick(fresh);
              // Only overwrite when the fresh read actually has a value for THIS field. `pick` returns a
              // string for stem/answer (never null), so an empty read would otherwise wipe the field —
              // the reported "everything resets to nothing" bug. Empty/whitespace ⇒ leave as-is.
              if (value !== null && value.trim() !== '') applyAi(key, current, value, applyText);
              else
                toast.toast({
                  tone: 'info',
                  title: 'No update for this field',
                  description:
                    'The page read did not return text for it — your current value is kept.',
                });
            },
            source,
          );
        }}
      />
      {preAi[key] !== undefined ? (
        <AiButton
          busy={false}
          disabled={fixing === key || reading === key}
          title="Undo the last AI change to this field"
          icon={<IconUndo />}
          onClick={() => {
            undoAi(key, applyText);
          }}
        />
      ) : null}
    </>
  );

  const toggle = (key: ImageModeKey, value: boolean): void => {
    setImageFlags((current) => ({ ...current, [key]: value }));
    setPendingImageWrites((current) => ({ ...current, [key]: current[key] + 1 }));
    void setImageMode
      .mutateAsync({ id: question.id, documentId: question.documentId, key, value })
      // The cache mutation restores the last API-confirmed value on failure. Keep the local visual
      // choice until that background reconciliation reaches this card rather than flashing mid-click.
      .catch(() => undefined)
      .finally(() => {
        setPendingImageWrites((current) => ({ ...current, [key]: Math.max(0, current[key] - 1) }));
      });
  };
  // Flag a specific question for later attention. Saved immediately (like the image flags), separate
  // from the local-first text drafts, and carried onto the bank row when the document is published.
  const toggleFlag = (): void => {
    void update.mutateAsync({ id: question.id, patch: { flagged: !question.flagged } });
  };

  const removeQuestionImage = (url: string): void => {
    const current = latestQuestion.current;
    const urls = splitUrls(current.questionImage).filter((u) => u !== url);
    void update.mutateAsync({
      id: current.id,
      patch: { questionImage: urls.length ? urls.join(',') : null },
    });
  };
  const removeOptionImage = (optionIndex: number): void => {
    const current = latestQuestion.current;
    const optionImages = [...current.optionImages];
    optionImages[optionIndex] = '';
    void update.mutateAsync({ id: current.id, patch: { optionImages } });
  };
  const removeAnswerImage = (url: string): void => {
    const current = latestQuestion.current;
    void update.mutateAsync({
      id: current.id,
      patch: { answerImages: current.answerImages.filter((u) => u !== url) },
    });
  };
  const removeExplanationImage = (url: string): void => {
    const current = latestQuestion.current;
    void update.mutateAsync({
      id: current.id,
      patch: { explanationImages: current.explanationImages.filter((u) => u !== url) },
    });
  };

  const armedFor = (type: 'question' | 'option', optionIndex = 0): boolean =>
    drawTarget !== null && drawTarget.type === type && drawTarget.optionIndex === optionIndex;
  const qBoxes = boxes.filter((b) => b.type === 'question');
  const savedQ = splitUrls(question.questionImage);
  const specs = [
    exam,
    subject,
    question.path.module,
    question.path.chapter,
    question.path.section,
  ].filter((part): part is string => Boolean(part && part.trim()));
  // The closed questionType master (7 kinds → behavior slugs). Keep the current draft value pickable
  // even when it is a legacy slug the masters set no longer lists (e.g. true_false → subjective).
  const questionTypeOptions: ComboboxOption[] = toQuestionTypeOptions(
    questionTypeDict.data?.entries ?? [],
  );
  if (
    draft.questionType &&
    !questionTypeOptions.some((option) => option.value === draft.questionType)
  ) {
    questionTypeOptions.push({ value: draft.questionType, label: draft.questionType });
  }
  const levelOptions: ComboboxOption[] = (levelDict.data?.entries ?? []).map((entry) => ({
    value: entry.key,
    label: entry.name,
  }));
  const sectionOptions = (sectionDict.data?.entries ?? []).map((entry) => entry.name);
  const examOptions = (examDict.data?.entries ?? []).map((entry) => entry.name);
  const topicSuggestions = [
    ...new Set(
      [question.path.chapter, ...(topicDict.data?.entries ?? []).map((entry) => entry.name)].filter(
        Boolean,
      ),
    ),
  ];

  // The editor profile comes from the selected type, not just the presence of an array on the row.
  // That keeps free-response types free of stale MCQ chrome, while legacy/custom types can still show
  // their existing extracted choices safely.
  const profile: ChoiceProfile =
    draft.match !== null ? 'matrix' : choiceProfile(draft.questionType, draft.options.length);
  const matrixSynthesis = draft.match ? synthesizeMatrixChoiceOptions(draft.match) : null;
  const generatedMatrixChoiceCount = draft.options.filter(isGeneratedMatrixOption).length;
  const sourceMatrixChoiceCount = draft.options.filter(
    (option) => option.generated === undefined,
  ).length;
  const customMatrixChoiceCount = draft.options.filter(
    (option) => option.generated === false,
  ).length;
  // A bare true/false question is faster to review as two answer buttons. When the extractor supplied
  // printed choices, it still gets the normal choice-card editor so their wording and figures survive.
  const usesCompactTruthAnswer = draft.questionType === 'true_false' && draft.options.length === 0;
  const showChoiceSection = profile === 'choices' && !usesCompactTruthAnswer;
  const hasOptionsSection = showChoiceSection || profile === 'matrix';
  const showMatrixSetup = profile === 'matrix' && draft.match === null;
  const isStandaloneComprehension = draft.questionType === 'comprehension';
  const showAnswerSection = !isStandaloneComprehension;
  // For single-choice profiles the operator can click an option to set the correct answer; multi is
  // checkbox-like. Assertion/reason and true/false are also single-choice when their choices exist.
  const multiCorrect = draft.questionType === 'multi_correct';
  const optionsSelectable =
    showChoiceSection &&
    (draft.questionType === 'single_correct' ||
      draft.questionType === 'assertion_reason' ||
      draft.questionType === 'true_false' ||
      multiCorrect);
  const correctLabels = optionsSelectable
    ? correctLabelsFromAnswer(draft.answer, draft.options)
    : new Set<string>();

  /**
   * Keep the denormalized `options[].isCorrect` markers in step with a canonical choice answer.
   * Free-response/mapping answers intentionally leave option markers alone; an empty choice answer
   * explicitly clears them.
   */
  const applyChoiceAnswer = (answer: string): void => {
    onDraftUpdate((prev) => {
      if (prev.match) {
        const selectedLabel = resolveOptionLabel(answer, prev.options);
        if (selectedLabel) {
          const selected = prev.options.find(
            (option) => optionLabelKey(option.label) === optionLabelKey(selectedLabel),
          );
          return selectExistingMatrixOption(prev, selectedLabel, selected?.body ?? '');
        }

        // Answer-key pages for direct-response matrices commonly return the raw mapping rather than
        // an A/B/C/D label. Fold that map into the table first, then make/select the deterministic
        // choice that represents it; never leave a raw map beside stale selectable choices.
        const parsed = parseOptionMatching(answer, targetLabelsForMatch(prev.match));
        if (Object.keys(parsed).length > 0) {
          const nextMatch = { columns: prev.match.columns, key: parsed };
          const synced = synchronizeMatrixChoiceState(prev.options, prev.answer, nextMatch);
          return { ...prev, match: nextMatch, ...synced };
        }
        return { ...prev, answer };
      }
      const hasChoices = choiceProfile(prev.questionType, prev.options.length) === 'choices';
      if (!hasChoices) return { ...prev, answer };
      const labels = correctLabelsFromAnswer(answer, prev.options);
      const canSynchronize = labels.size > 0 || answer.trim() === '';
      return {
        ...prev,
        answer,
        options: canSynchronize ? withCorrectOptions(prev.options, labels) : prev.options,
      };
    });
  };

  /**
   * An Answer/solution page can complete a matrix's matching key and return the server-synthesized
   * selectable choices with its answer label. Applying only the label loses that structure (and can
   * leave `C` pointing at no local option), so accept the whole matrix payload in one latest-draft
   * update. A reply with only plain answer text keeps the normal `applyChoiceAnswer` fallback.
   */
  const applyMatrixAnswerReExtract = (fresh: ReExtractedQuestion): boolean => {
    if (fresh.match === null && fresh.options.length === 0) return false;
    onDraftUpdate((prev) => {
      const match = fresh.match ?? prev.match;
      const options = fresh.options.length > 0 ? fresh.options : prev.options;
      const answer = fresh.answer.trim() || prev.answer;
      if (match === null) return { ...prev, options, answer };
      const synced = synchronizeMatrixChoiceState(options, answer, match);
      return { ...prev, match, ...synced };
    });
    return true;
  };

  const toggleCorrect = (optionLabel: string): void => {
    // Compute from the latest draft because clicking two checkboxes in quick succession must not
    // drop the first selection while React is batching the card's local updates.
    onDraftUpdate((prev) => {
      const selectedLabel = resolveOptionLabel(optionLabel, prev.options) ?? optionLabel;
      const next = multiCorrect
        ? correctLabelsFromAnswer(prev.answer, prev.options)
        : new Set<string>();
      const selectedKey = optionLabelKey(selectedLabel);
      const alreadySelected = [...next].some((label) => optionLabelKey(label) === selectedKey);
      if (multiCorrect && alreadySelected) {
        for (const existing of [...next]) {
          if (optionLabelKey(existing) === selectedKey) next.delete(existing);
        }
      } else {
        // A single-correct/two-state card always selects precisely the clicked printed label.
        if (!multiCorrect) next.clear();
        next.add(selectedLabel);
      }
      return {
        ...prev,
        answer: labelsToAnswer(next, prev.options),
        options: withCorrectOptions(prev.options, next),
      };
    });
  };
  const requestedOptionColumns =
    OPTION_LAYOUTS.find((layout) => layout.value === optionLayout)?.maxColumns ?? 1;
  // The chosen view must be literal: earlier width-capping silently turned 3/4 views into 1/2.
  const optionColumns = requestedOptionColumns;
  const imageModeSaving =
    pendingImageWrites.isQuestionImage > 0 || pendingImageWrites.isOptionImage > 0;
  const selectedQuestionType =
    questionTypeOptions.find((option) => option.value === draft.questionType)?.label ??
    draft.questionType;
  const answerDetails = answerCopy(draft.questionType);
  const canCropAnswer = Boolean(answerSource || inlineAnswers);
  const canCropSolution = Boolean(solutionSource || inlineAnswers);
  const hasSecondarySection = hasOptionsSection || isStandaloneComprehension;
  const optionSectionNumber = hasSecondarySection ? '2' : null;
  const answerSectionNumber = showAnswerSection ? String(1 + (hasSecondarySection ? 1 : 0)) : null;
  const explanationSectionNumber = String(
    1 + (hasSecondarySection ? 1 : 0) + (showAnswerSection ? 1 : 0),
  );
  const settingsSectionNumber = String(Number(explanationSectionNumber) + 1);
  const choiceTitle =
    draft.questionType === 'assertion_reason'
      ? 'Assertion & reason choices'
      : draft.questionType === 'true_false'
        ? 'True / false choices'
        : 'Options';
  const settingPills = [
    { label: 'Type', value: selectedQuestionType },
    { label: 'Level', value: draft.level },
    { label: 'Section', value: draft.sectionName },
    { label: 'Topic', value: draft.topic },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value && item.value.trim()),
  );

  const renderStandardAnswer = (sectionNumber: string): JSX.Element => (
    <section
      aria-labelledby={`answer-${question.id}`}
      className="flex flex-col gap-2 border-l-[3px] border-a pl-3"
    >
      <EditorSectionHeader
        number={sectionNumber}
        title="Answer"
        tone="answer"
        id={`answer-${question.id}`}
        actions={
          <>
            {fieldAi(
              'answer',
              draft.answer,
              applyChoiceAnswer,
              (fresh) => fresh.answer,
              answerSource,
            )}
            {canCropAnswer ? (
              <CropImageButton
                label={
                  question.answerImages.length > 0 ? 'Add another figure' : 'Add answer figure'
                }
                disabled={cropDisabled}
                onRequestCrop={() => onRequestCrop(question.id, 'answer')}
              />
            ) : null}
          </>
        }
      />
      <span className={FIELD_LABEL}>{answerDetails.label}</span>
      {draft.questionType === 'true_false' && !showChoiceSection ? (
        <div className="flex flex-wrap items-center gap-2">
          {['True', 'False'].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.answer.trim().toLowerCase() === value.toLowerCase()}
              onClick={() => {
                applyChoiceAnswer(value);
              }}
              className={
                draft.answer.trim().toLowerCase() === value.toLowerCase()
                  ? 'rounded-md border border-a bg-warn-soft px-3 py-1.5 text-sm font-semibold text-warn'
                  : 'rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-line-strong'
              }
            >
              {value}
            </button>
          ))}
        </div>
      ) : (
        <EditableLatexValue
          value={draft.answer}
          onChange={applyChoiceAnswer}
          multiline={draft.questionType === 'subjective'}
          placeholder={answerDetails.placeholder}
        />
      )}
      {question.answerImages.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-2">
          {question.answerImages.map((url, index) => (
            <FigureThumbnail
              key={url}
              src={url}
              alt={`answer figure ${String(index + 1)}`}
              disabled={cropDisabled}
              onRemove={() => {
                removeAnswerImage(url);
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );

  const renderMatrixSetup = (): JSX.Element => (
    <section
      aria-labelledby={`options-${question.id}`}
      className="flex flex-col gap-2 border-l-[3px] border-line-strong pl-3"
    >
      <EditorSectionHeader
        number={optionSectionNumber ?? '2'}
        title="Matrix match"
        tone="options"
        id={`options-${question.id}`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                const nextLabel = nextOptionLabel(draft.options);
                set('options', [
                  ...draft.options,
                  { label: nextLabel, body: '', isCorrect: false, generated: false },
                ]);
              }}
            >
              <IconPlus /> Add choice
            </Button>
            <Button size="xs" onClick={seedMatch}>
              <IconPlus /> Set up match columns
            </Button>
          </div>
        }
      />
      <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
        <p className="m-0 text-sm font-medium text-ink">Set up the matching table</p>
        <p className="m-0 mt-1 text-xs leading-relaxed text-ink-2">
          Create the table, then add every entry and its correct matches. Once the key is complete,
          Verify generates selectable answer choices directly from that mapping.
        </p>
      </div>
      {draft.options.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2">
          <span className={FIELD_LABEL}>Answer choices</span>
          {draft.options.map((option, index) => (
            <div
              key={index}
              className="flex items-start gap-2 rounded-lg border border-line bg-surface p-2"
            >
              <strong className="mt-2.5 flex-none text-sm text-ink">{option.label}.</strong>
              <div className="min-w-0 flex-1">
                <EditableLatexValue
                  value={option.body}
                  onChange={(value) => {
                    setOption(index, value);
                  }}
                  placeholder="Click to edit answer choice"
                />
              </div>
              <IconButton
                icon={<IconX />}
                label="Remove answer choice"
                size="sm"
                onClick={() => {
                  set(
                    'options',
                    draft.options.filter((_, itemIndex) => itemIndex !== index),
                  );
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );

  const renderEmptyMatrixAnswer = (): JSX.Element => (
    <section
      aria-labelledby={`answer-${question.id}`}
      className="flex flex-col gap-2 border-l-[3px] border-a pl-3"
    >
      <EditorSectionHeader
        number={answerSectionNumber ?? '3'}
        title="Answer"
        tone="answer"
        id={`answer-${question.id}`}
        actions={
          <>
            {fieldAi(
              'answer',
              draft.answer,
              applyChoiceAnswer,
              (fresh) => fresh.answer,
              answerSource,
              applyMatrixAnswerReExtract,
            )}
            {canCropAnswer ? (
              <CropImageButton
                label={
                  question.answerImages.length > 0 ? 'Add another figure' : 'Add answer figure'
                }
                disabled={cropDisabled}
                onRequestCrop={() => onRequestCrop(question.id, 'answer')}
              />
            ) : null}
          </>
        }
      />
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
        Create the match columns above to build the answer key.
      </div>
      {question.answerImages.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-2">
          {question.answerImages.map((url, index) => (
            <FigureThumbnail
              key={url}
              src={url}
              alt={`answer figure ${String(index + 1)}`}
              disabled={cropDisabled}
              onRemove={() => {
                removeAnswerImage(url);
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );

  return (
    <div
      className={
        nested
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-3 rounded-xl border border-line bg-surface p-4'
      }
    >
      <div className="flex items-center gap-2.5">
        {selection ? (
          <input
            type="checkbox"
            className="w-auto"
            checked={selection.checked}
            onChange={selection.onChange}
            title="Select to group into a comprehension"
            aria-label={`Select question ${String(number)} to group into a comprehension`}
          />
        ) : null}
        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
          Q{number}
        </span>
        {dirty ? <Badge tone="progress">Unsaved</Badge> : null}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <Button
            size="xs"
            variant={question.flagged ? 'primary' : 'ghost'}
            disabled={update.isPending}
            title={question.flagged ? 'Remove the flag' : 'Flag this question to edit later'}
            onClick={toggleFlag}
          >
            <IconFlag /> {question.flagged ? 'Flagged' : 'Flag'}
          </Button>
          <label
            className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${imageFlags.isQuestionImage ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2 hover:border-line-strong hover:bg-surface-2'}`}
          >
            <input
              type="checkbox"
              className="w-auto"
              checked={imageFlags.isQuestionImage}
              onChange={(e) => {
                toggle('isQuestionImage', e.target.checked);
              }}
            />
            Question figures
          </label>
          {showChoiceSection ? (
            <label
              className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${imageFlags.isOptionImage ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2 hover:border-line-strong hover:bg-surface-2'}`}
            >
              <input
                type="checkbox"
                className="w-auto"
                checked={imageFlags.isOptionImage}
                onChange={(e) => {
                  toggle('isOptionImage', e.target.checked);
                }}
              />
              Option figures
            </label>
          ) : null}
          {imageModeSaving ? (
            <span className="text-[11px] text-ink-3" role="status" aria-live="polite">
              Saving figures…
            </span>
          ) : null}
        </div>
      </div>

      {specs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
          {specs.map((part, i) => (
            <span key={`${part}-${String(i)}`} className="inline-flex items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden className="text-line-strong">
                  ›
                </span>
              ) : null}
              {part}
            </span>
          ))}
        </div>
      ) : null}

      <section
        aria-labelledby={`question-${question.id}`}
        className="flex flex-col gap-2 border-l-[3px] border-q pl-3"
      >
        <EditorSectionHeader
          number="1"
          title="Question"
          tone="question"
          id={`question-${question.id}`}
          actions={fieldAi(
            'stem',
            draft.stem,
            (t) => {
              set('stem', t);
            },
            (fresh) => fresh.stem,
          )}
        />
        <span className={FIELD_LABEL}>Question text</span>
        <EditableLatexValue
          value={draft.stem}
          onChange={(v) => {
            set('stem', v);
          }}
          multiline
        />
        {imageFlags.isQuestionImage ? (
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className={FIELD_LABEL}>Question figures</span>
              <Button
                size="xs"
                variant={armedFor('question') ? 'primary' : 'default'}
                disabled={cropDisabled}
                aria-pressed={armedFor('question')}
                title={
                  armedFor('question')
                    ? 'Cancel drawing'
                    : 'Draw the figure on the page — it saves automatically'
                }
                onClick={() => {
                  onDrawRegion(question, 'question');
                }}
              >
                {armedFor('question') ? (
                  'Drawing… (Esc to cancel)'
                ) : (
                  <>
                    <IconPlus /> Add region
                  </>
                )}
              </Button>
            </div>
            {qBoxes.map((box) => (
              <div
                key={box.id}
                className="inline-flex items-center gap-1.5 self-start rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-2"
              >
                <span>Region {box.label}</span>
                <div className="flex items-center gap-1">
                  {box.saving ? (
                    <span className="inline-flex items-center gap-1">
                      <Spinner /> Saving…
                    </span>
                  ) : (
                    <>
                      <Button
                        size="xs"
                        disabled={cropDisabled}
                        onClick={() => {
                          onSaveBox(box.id);
                        }}
                      >
                        Save
                      </Button>
                      <IconButton
                        icon={<IconX />}
                        label="Remove region"
                        size="sm"
                        onClick={() => {
                          onDeleteBox(box.id);
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            ))}
            {savedQ.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-2">
                {savedQ.map((url, index) => (
                  <FigureThumbnail
                    key={url}
                    src={url}
                    alt={`question figure ${String(index + 1)}`}
                    disabled={cropDisabled}
                    onRemove={() => {
                      removeQuestionImage(url);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {draft.match ? (
        <>
          <section
            aria-labelledby={`options-${question.id}`}
            className="flex flex-col gap-2 border-l-[3px] border-line-strong pl-3"
          >
            <EditorSectionHeader
              number={optionSectionNumber ?? '2'}
              title="Matrix match"
              tone="options"
              id={`options-${question.id}`}
              actions={
                <Button
                  size="xs"
                  onClick={() => {
                    const nextLabel = nextOptionLabel(draft.options);
                    set('options', [
                      ...draft.options,
                      { label: nextLabel, body: '', isCorrect: false, generated: false },
                    ]);
                  }}
                >
                  <IconPlus /> Add choice
                </Button>
              }
            />
            <MatchTableEditor
              value={draft.match}
              onChange={setMatch}
              disabled={saving}
              onCropImage={() => onRequestCrop(question.id, 'question')}
            />

            <div className="flex flex-col gap-1.5 border-t border-line pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={FIELD_LABEL}>Answer choices</span>
                {generatedMatrixChoiceCount > 0 ? (
                  <Badge tone="progress" dot={false}>
                    Generated from matching
                  </Badge>
                ) : null}
                {sourceMatrixChoiceCount > 0 ? (
                  <Badge tone="neutral" dot={false}>
                    Printed
                  </Badge>
                ) : null}
                {customMatrixChoiceCount > 0 ? (
                  <Badge tone="review" dot={false}>
                    Custom
                  </Badge>
                ) : null}
              </div>
              {generatedMatrixChoiceCount > 0 ? (
                <p className="m-0 text-[13px] leading-relaxed text-ink-3">
                  Generated choices use only the labels in this table. Edit the matching and its
                  generated correct choice stays aligned; source and custom choices are preserved.
                </p>
              ) : null}
              {draft.options.length === 0 ? (
                <p
                  role="status"
                  className="m-0 rounded-md border border-dashed border-line-strong bg-surface-2 px-2.5 py-2 text-[13px] leading-relaxed text-ink-2"
                >
                  {matrixSynthesis?.status === 'blocked'
                    ? matrixChoiceSetupCopy(matrixSynthesis.reason)
                    : 'Generating answer choices from the matching…'}
                </p>
              ) : null}
              {draft.options.map((option, i) => {
                const selected = correctLabelsFromAnswer(draft.answer, draft.options).has(
                  option.label,
                );
                const origin =
                  option.generated === true
                    ? 'Generated'
                    : option.generated === false
                      ? 'Custom'
                      : 'Printed';
                return (
                  <div
                    key={i}
                    className="flex min-w-0 items-start gap-2 rounded-lg border border-line bg-surface p-2"
                  >
                    <div className="pt-1">
                      <OptionCorrectToggle
                        label={option.label}
                        correct={selected}
                        multi={false}
                        onToggle={() => {
                          selectMatrixOption(option.label, option.body);
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-start gap-1 pt-1">
                      <strong className={`text-sm ${selected ? 'text-ok' : ''}`}>
                        {option.label}.
                      </strong>
                      <span
                        className={
                          option.generated === true
                            ? 'rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand'
                            : option.generated === false
                              ? 'rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-2'
                              : 'rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn'
                        }
                      >
                        {origin}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <EditableLatexValue
                        value={option.body}
                        onChange={(value) => {
                          setOption(i, value);
                        }}
                        placeholder="Click to edit answer choice"
                      />
                    </div>
                    <IconButton
                      icon={<IconX />}
                      label={`Remove ${origin.toLowerCase()} answer choice`}
                      size="sm"
                      onClick={() => {
                        removeMatrixOption(i);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby={`answer-${question.id}`}
            className="flex flex-col gap-2 border-l-[3px] border-a pl-3"
          >
            <EditorSectionHeader
              number={answerSectionNumber ?? '3'}
              title="Answer"
              tone="answer"
              id={`answer-${question.id}`}
              actions={
                <>
                  {fieldAi(
                    'answer',
                    draft.answer,
                    applyChoiceAnswer,
                    (fresh) => fresh.answer,
                    answerSource,
                    applyMatrixAnswerReExtract,
                  )}
                  <Button
                    variant="ghost"
                    size="xs"
                    title="Clear this table and return to the matrix setup state"
                    onClick={clearMatrixTable}
                  >
                    Clear table
                  </Button>
                  {canCropAnswer ? (
                    <CropImageButton
                      label={
                        question.answerImages.length > 0
                          ? 'Add another figure'
                          : 'Add answer figure'
                      }
                      disabled={cropDisabled}
                      onRequestCrop={() => onRequestCrop(question.id, 'answer')}
                    />
                  ) : null}
                </>
              }
            />
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Answer key</span>
              <div className="min-h-[38px] rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
                {draft.answer.trim() ? (
                  draft.answer
                ) : (
                  <span className="text-ink-3">
                    Select a printed option, or fill the direct matching above
                  </span>
                )}
              </div>
            </div>
            {question.answerImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-2">
                {question.answerImages.map((url, index) => (
                  <FigureThumbnail
                    key={url}
                    src={url}
                    alt={`answer figure ${String(index + 1)}`}
                    disabled={cropDisabled}
                    onRemove={() => {
                      removeAnswerImage(url);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <>
          {showMatrixSetup ? renderMatrixSetup() : null}

          {showChoiceSection ? (
            <section
              aria-labelledby={`options-${question.id}`}
              className="flex flex-col gap-2 border-l-[3px] border-line-strong pl-3"
            >
              <EditorSectionHeader
                number={optionSectionNumber ?? '2'}
                title={choiceTitle}
                tone="options"
                id={`options-${question.id}`}
                actions={
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <div
                      className="flex items-center gap-1"
                      role="group"
                      aria-label="Option layout"
                    >
                      <span className="text-[11px] font-medium text-ink-3">View</span>
                      <div className="flex overflow-hidden rounded-md border border-line bg-surface">
                        {OPTION_LAYOUTS.map((layout) => (
                          <button
                            key={layout.value}
                            type="button"
                            title={layout.title}
                            aria-label={layout.title}
                            aria-pressed={optionLayout === layout.value}
                            onClick={() => {
                              setOptionLayout(layout.value);
                            }}
                            className={`min-w-7 border-r border-line px-1.5 py-1 text-[11px] font-medium last:border-r-0 ${optionLayout === layout.value ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-2'}`}
                          >
                            {layout.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="xs"
                      onClick={() => {
                        const nextLabel = nextOptionLabel(draft.options);
                        set('options', [
                          ...draft.options,
                          { label: nextLabel, body: '', isCorrect: false },
                        ]);
                      }}
                    >
                      <IconPlus /> Add option
                    </Button>
                  </div>
                }
              />
              {draft.options.length === 0 ? (
                <p className="m-0 rounded-lg border border-dashed border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-2">
                  No choices extracted yet. Add the choices shown on the source, or re-extract this
                  question from Settings.
                </p>
              ) : null}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${String(optionColumns)}, minmax(0, 1fr))` }}
              >
                {draft.options.map((option, i) => {
                  const correct =
                    optionsSelectable && correctLabels.has(option.label.toUpperCase());
                  const savedImage = imageFlags.isOptionImage ? question.optionImages[i] : '';
                  const optionBoxes = boxes.filter(
                    (box) => box.type === 'option' && box.optionIndex === i,
                  );
                  return (
                    <div
                      key={i}
                      className="min-w-0 rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-line-strong"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {optionsSelectable ? (
                            <OptionCorrectToggle
                              label={option.label}
                              correct={correct}
                              multi={multiCorrect}
                              onToggle={() => {
                                toggleCorrect(option.label);
                              }}
                            />
                          ) : null}
                          <strong className={correct ? 'text-ok' : undefined}>
                            {option.label}.
                          </strong>
                        </div>
                        <div className="flex flex-none items-center gap-1">
                          {fieldAi(
                            `opt${String(i)}`,
                            option.body,
                            (text) => {
                              setOption(i, text);
                            },
                            (fresh) => fresh.options[i]?.body ?? null,
                          )}
                          <IconButton
                            icon={<IconX />}
                            label="Remove option"
                            size="sm"
                            onClick={() => {
                              set(
                                'options',
                                draft.options.filter((_, itemIndex) => itemIndex !== i),
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 min-w-0 space-y-2">
                        <EditableLatexValue
                          value={option.body}
                          onChange={(value) => {
                            setOption(i, value);
                          }}
                          placeholder="Click to edit option"
                        />
                        {imageFlags.isOptionImage ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 p-2">
                            {savedImage ? (
                              <FigureThumbnail
                                src={savedImage}
                                alt={`option ${option.label} figure`}
                                disabled={cropDisabled}
                                onRemove={() => {
                                  removeOptionImage(i);
                                }}
                              />
                            ) : null}
                            {optionBoxes.map((box) => (
                              <div
                                key={box.id}
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-1 text-xs text-ink-2"
                              >
                                {box.saving ? (
                                  <>
                                    <Spinner /> Saving…
                                  </>
                                ) : (
                                  <Button
                                    size="xs"
                                    disabled={cropDisabled}
                                    onClick={() => {
                                      onSaveBox(box.id);
                                    }}
                                  >
                                    Save
                                  </Button>
                                )}
                                <IconButton
                                  icon={<IconX />}
                                  label="Remove region"
                                  size="sm"
                                  onClick={() => {
                                    onDeleteBox(box.id);
                                  }}
                                />
                              </div>
                            ))}
                            <Button
                              size="xs"
                              variant={armedFor('option', i) ? 'primary' : 'default'}
                              disabled={cropDisabled}
                              aria-pressed={armedFor('option', i)}
                              title={
                                armedFor('option', i)
                                  ? 'Cancel drawing'
                                  : 'Draw this option’s figure on the page — it saves automatically'
                              }
                              onClick={() => {
                                onDrawRegion(question, 'option', i);
                              }}
                            >
                              {armedFor('option', i) ? (
                                'Drawing…'
                              ) : (
                                <>
                                  <IconPlus /> Add figure
                                </>
                              )}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {isStandaloneComprehension ? (
            <section
              aria-labelledby={`options-${question.id}`}
              className="flex flex-col gap-2 border-l-[3px] border-line-strong pl-3"
            >
              <EditorSectionHeader
                number={optionSectionNumber ?? '2'}
                title="Comprehension structure"
                tone="options"
                id={`options-${question.id}`}
              />
              <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 p-3 text-sm text-ink-2">
                A comprehension is a shared passage with individual child questions. Re-extract this
                item or group the related questions into a passage; it does not use a standalone
                answer or generic choices.
              </div>
            </section>
          ) : null}

          {showMatrixSetup ? renderEmptyMatrixAnswer() : null}
          {!showMatrixSetup && showAnswerSection
            ? renderStandardAnswer(answerSectionNumber ?? '2')
            : null}
        </>
      )}

      <section
        aria-labelledby={`explanation-${question.id}`}
        className="flex flex-col gap-2 border-l-[3px] border-s pl-3"
      >
        <EditorSectionHeader
          number={explanationSectionNumber}
          title="Explanation"
          tone="explanation"
          id={`explanation-${question.id}`}
          actions={
            explanationOpen ? (
              <>
                {fieldAi(
                  'explanation',
                  draft.explanation,
                  (text) => {
                    set('explanation', text);
                  },
                  (fresh) => fresh.explanation ?? '',
                  solutionSource,
                )}
                {canCropSolution ? (
                  <CropImageButton
                    label={
                      question.explanationImages.length > 0
                        ? 'Add another figure'
                        : 'Add explanation figure'
                    }
                    disabled={cropDisabled}
                    onRequestCrop={() => onRequestCrop(question.id, 'solution')}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="xs"
                  aria-expanded
                  title="Collapse the explanation editor"
                  onClick={() => {
                    setExplanationOpen(false);
                  }}
                >
                  Collapse
                </Button>
              </>
            ) : (
              <Button
                variant="default"
                size="xs"
                aria-expanded={false}
                title="Add an explanation or solution figure"
                onClick={() => {
                  setExplanationOpen(true);
                }}
              >
                <IconPlus /> Add explanation
              </Button>
            )
          }
        />
        {explanationOpen ? (
          <>
            <EditableLatexValue
              value={draft.explanation}
              onChange={(value) => {
                set('explanation', value);
              }}
              multiline
              placeholder="Click to add explanation"
            />
            {question.explanationImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-2">
                {question.explanationImages.map((url, index) => (
                  <FigureThumbnail
                    key={url}
                    src={url}
                    alt={`explanation figure ${String(index + 1)}`}
                    disabled={cropDisabled}
                    onRemove={() => {
                      removeExplanationImage(url);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            className="flex min-h-8 items-center justify-between rounded-md px-2 text-left text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
            onClick={() => {
              setExplanationOpen(true);
            }}
          >
            <span>No explanation extracted.</span>
            <span className="font-medium text-s">Add one</span>
          </button>
        )}
      </section>

      <details
        className="group rounded-lg border border-line bg-surface"
        aria-label="Question settings"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm marker:content-none">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft px-1 text-[11px] font-bold text-brand">
              {settingsSectionNumber}
            </span>
            <span className="font-semibold text-ink">Settings</span>
            {settingPills.length > 0 ? (
              settingPills.map((item) => (
                <span
                  key={item.label}
                  title={`${item.label}: ${item.value}`}
                  className="inline-flex max-w-48 items-center overflow-hidden rounded-full border border-line bg-surface-2 text-[11px] text-ink-2"
                >
                  <span className="flex-none bg-white px-1.5 py-0.5 font-semibold text-ink-3">
                    {item.label}
                  </span>
                  <span className="truncate px-1.5 py-0.5">{item.value}</span>
                </span>
              ))
            ) : (
              <span className="text-xs text-ink-3">Classification and re-extraction</span>
            )}
          </div>
          <span className="flex flex-none items-center gap-1 text-xs text-ink-3">
            Configure{' '}
            <IconChevronDown className="transition-transform duration-150 group-open:rotate-180" />
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-line p-3">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(148px,1fr))]">
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Question type</span>
              <Combobox
                value={draft.questionType}
                options={questionTypeOptions}
                allowCustom={false}
                placeholder="Select type…"
                onChange={setQuestionType}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Difficulty</span>
              <Combobox
                value={draft.level}
                options={levelOptions}
                allowCustom={false}
                placeholder="Select difficulty…"
                onChange={(v) => {
                  set('level', v);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Section</span>
              <Combobox
                value={draft.sectionName}
                options={sectionOptions}
                allowCustom={false}
                placeholder="e.g. Exercise-1"
                onChange={(v) => {
                  set('sectionName', v);
                }}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Topic</span>
              <Combobox
                value={draft.topic}
                options={topicSuggestions}
                allowCustom={false}
                placeholder="e.g. Kinematics"
                onChange={(v) => {
                  set('topic', v);
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/20 bg-brand-soft p-2.5">
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold text-ink">Re-extract from the source page</p>
              <p className="m-0 mt-0.5 text-[11px] leading-snug text-ink-2">
                Rebuilds this question as {selectedQuestionType || 'the selected type'}. Review the
                result, then click Update.
              </p>
            </div>
            <Button
              variant="primary"
              size="xs"
              disabled={reading !== null || fixing !== null}
              title="Re-read this question from its source page using the selected question type"
              onClick={() => {
                void reExtractWhole();
              }}
            >
              {reading === WHOLE_REEXTRACT ? (
                <>
                  <Spinner /> Re-extracting question…
                </>
              ) : (
                <>
                  <IconScan /> Re-extract question
                </>
              )}
            </Button>
          </div>
        </div>
      </details>

      {question.isPyq ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>PYQ exam</span>
            <Combobox
              value={draft.pyqExam}
              options={examOptions}
              allowCustom={false}
              placeholder="e.g. NEET"
              onChange={(v) => {
                set('pyqExam', v);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>PYQ year</span>
            <Combobox
              value={draft.pyqYear}
              options={[]}
              placeholder="e.g. 2019"
              onChange={(v) => {
                set('pyqYear', v);
              }}
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Button size="xs" variant="danger" onClick={onDelete}>
          <IconTrash /> Delete
        </Button>
        <Button size="xs" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Update'}
        </Button>
      </div>
    </div>
  );
}
