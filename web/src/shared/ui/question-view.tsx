import type { JSX, ReactNode } from 'react';
import { RenderLatex } from '../lib/latex.js';
import { questionTypeLabel } from '../lib/question-types.js';
import { Badge } from './badge.js';
import { IconCheck, IconLayers } from './icons.js';

/**
 * The ONE read-only question renderer (design law §0: one concept, one component). Every surface that
 * *shows* a question — the published-questions browse, a comprehension group, any future preview —
 * renders through this so a question of any type looks identical everywhere and no field silently goes
 * missing. It is source-agnostic: callers map their own shape (the ingest `Question` + `Passage`, or the
 * flattened `CatalogQuestion`) into the {@link QuestionViewModel} below, so the two data models converge
 * on one visual. The verify screen keeps its editable card; this is its read-only twin.
 */

/** One answer option, fully resolved: its printed label, LaTeX-bearing text, correctness, and figure. */
export type QuestionViewOption = {
  label: string;
  body: string;
  isCorrect: boolean;
  /** The option's figure (already an absolute URL), or null when it has none. */
  image: string | null;
};

export type QuestionViewMatchEntry = { label: string; body: string; image: string | null };
export type QuestionViewMatchColumn = { title: string; entries: QuestionViewMatchEntry[] };
/** Structured match-the-column data: the columns and the correct first-column → later-column matching. */
export type QuestionViewMatch = {
  columns: QuestionViewMatchColumn[];
  key: Record<string, readonly string[]>;
};

/** The complete, render-ready view of one question — the normalized target both data models map into. */
export type QuestionViewModel = {
  /** The printed / ordinal question number, or null when unnumbered. */
  number: number | null;
  /** The raw question-type slug (labelled for display via {@link questionTypeLabel}); null when unset. */
  type: string | null;
  stem: string;
  /** Question figures as absolute URLs (a comma-separated field is already split by the caller). */
  questionImages: string[];
  /** Printed choices. A matrix can carry these alongside its structured matching table. */
  options: QuestionViewOption[];
  match: QuestionViewMatch | null;
  answer: string | null;
  answerImages: string[];
  explanation: string | null;
  explanationImages: string[];
};

/** The shared passage of a comprehension group — rendered ONCE above its sub-questions. */
export type PassageViewModel = {
  text: string;
  images: string[];
};

const FIELD_LABEL = 'flex items-center gap-1.5 text-[13px] font-medium text-ink-2';

/**
 * A matrix with printed A/B/C/D choices stores the selected choice in `answer`, while its `match`
 * remains the supporting relationship. Resolve that answer into option highlighting without treating a
 * direct-match key ("P-1; Q-2") as an option selection.
 */
function selectedChoiceLabels(answer: string | null): Set<string> {
  const value = answer?.trim().toUpperCase() ?? '';
  if (!/^[A-Z](?:[\s,;/]*[A-Z])*$/.test(value)) return new Set();
  return new Set(value.match(/[A-Z]/g) ?? []);
}

/** Trust only absolute-URL images; fix the common double-encoding (`%2520` → `%20`). Others drop out. */
function safeImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http')) return null;
  return trimmed.replaceAll('%2520', '%20');
}

/** A responsive grid of figures, or nothing when none of the URLs are usable. */
function FigureGrid({ urls, alt }: { urls: readonly string[]; alt: string }): JSX.Element | null {
  const safe = urls.map(safeImageUrl).filter((url): url is string => url !== null);
  if (safe.length === 0) return null;
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
      {safe.map((url) => (
        <img
          key={url}
          src={url}
          alt={alt}
          className="max-h-72 w-auto max-w-full rounded-lg border border-line bg-white object-contain"
        />
      ))}
    </div>
  );
}

/** One option row: label, LaTeX text and/or its figure, with the correct option in the green treatment. */
function OptionRow({
  option,
  action,
}: {
  option: QuestionViewOption;
  action?: ReactNode;
}): JSX.Element {
  const image = option.image ? safeImageUrl(option.image) : null;
  return (
    <li
      className={
        option.isCorrect
          ? 'flex items-start gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2 text-sm text-ink'
          : 'flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-2'
      }
    >
      <span className="flex-none pt-0.5 font-semibold">{option.label}.</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {option.body.trim() ? <RenderLatex text={option.body} /> : null}
        {image ? (
          <img
            src={image}
            alt={`Option ${option.label}`}
            className="max-h-48 w-auto max-w-full rounded-lg border border-line bg-white object-contain"
          />
        ) : null}
      </div>
      {option.isCorrect ? <IconCheck className="mt-0.5 flex-none text-ok [&>svg]:size-4" /> : null}
      {action ? <span className="flex-none">{action}</span> : null}
    </li>
  );
}

/** The labels a match key can point AT: every entry in the second column onward. */
function targetLabelsOf(match: QuestionViewMatch): string[] {
  return match.columns.slice(1).flatMap((column) => column.entries.map((entry) => entry.label));
}

/** Read-only match-the-column: the columns (with entry figures) then the correct matching. */
export function MatchTableView({ match }: { match: QuestionViewMatch }): JSX.Element {
  const first = match.columns[0];
  const targets = targetLabelsOf(match);
  const hasKey = Object.values(match.key).some((values) => values.length > 0);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-2.5">
      <span className={FIELD_LABEL}>Match the column</span>
      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-2.5">
          {match.columns.map((column, colIndex) => (
            <div
              key={`${column.title}-${String(colIndex)}`}
              className="flex min-w-56 flex-1 flex-col gap-2 rounded-lg border border-line bg-surface p-2.5"
            >
              <div className="text-[13px] font-semibold text-ink">{column.title}</div>
              {column.entries.map((entry) => {
                const image = entry.image ? safeImageUrl(entry.image) : null;
                return (
                  <div key={entry.label} className="flex items-start gap-1.5 text-sm text-ink-2">
                    <span className="w-6 flex-none font-semibold text-ink">{entry.label}.</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      {entry.body.trim() ? <RenderLatex text={entry.body} /> : null}
                      {image ? (
                        <img src={image} alt={`Entry ${entry.label}`} className="max-h-24 w-auto rounded border border-line bg-white" />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {first && hasKey ? (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Correct matching</span>
          {first.entries
            .filter((entry) => (match.key[entry.label] ?? []).length > 0)
            .map((entry) => (
              <div key={entry.label} className="flex flex-wrap items-center gap-1.5">
                <span className="w-6 flex-none text-center text-sm font-semibold text-ink">{entry.label}</span>
                <span aria-hidden className="text-ink-3">→</span>
                {(match.key[entry.label] ?? []).map((target) => (
                  <span
                    key={target}
                    className={
                      targets.includes(target)
                        ? 'rounded-md border border-ok/40 bg-ok-soft px-2 py-0.5 text-[13px] font-semibold text-ok'
                        : 'rounded-md border border-line px-2 py-0.5 text-[13px] text-ink-2'
                    }
                  >
                    {target}
                  </span>
                ))}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The shared passage of a comprehension group. Rendered once, above the group's sub-question cards, with
 * its text and any shared figure — the same passage the verify screen edits in one place.
 */
export function PassageView({
  passage,
  count,
  actions,
}: {
  passage: PassageViewModel;
  /** How many sub-questions share this passage (shown as context), when known. */
  count?: number;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
          <IconLayers /> Passage
        </span>
        <Badge tone="neutral" dot={false}>{questionTypeLabel('comprehension')}</Badge>
        {count !== undefined ? (
          <span className="text-xs text-ink-3">
            {count} question{count === 1 ? '' : 's'} share this passage
          </span>
        ) : null}
        {actions ? (
          <>
            <span className="flex-1" />
            {actions}
          </>
        ) : null}
      </div>
      {passage.text.trim() ? (
        <div className="text-sm leading-relaxed text-ink"><RenderLatex text={passage.text} /></div>
      ) : null}
      <FigureGrid urls={passage.images} alt="Passage figure" />
    </div>
  );
}

type QuestionViewProps = {
  model: QuestionViewModel;
  /** Extra pills (taxonomy, PYQ, flagged) rendered in the header, after the type badge. */
  badges?: ReactNode;
  /** Right-aligned header actions (Edit / Flag / Open …). */
  actions?: ReactNode;
  /** Inline control after the "Question" label (e.g. the browse card's per-field AI fix). */
  stemAction?: ReactNode;
  /** Inline control after the "Answer" label. */
  answerAction?: ReactNode;
  /** Inline control at the end of option row `index` (e.g. its per-field AI fix). */
  optionAction?: (index: number) => ReactNode;
  /** Drop the card chrome (border/background/padding) — for a sub-question inside a group container. */
  nested?: boolean;
};

/**
 * Render one question read-only, with every field it carries, in the sheet's canonical order: number +
 * type, stem, question figures, then the body (a match table for matrix types, else the options with
 * their figures and the correct one highlighted), the answer, and the explanation with its figures.
 */
export function QuestionView({
  model,
  badges,
  actions,
  stemAction,
  answerAction,
  optionAction,
  nested = false,
}: QuestionViewProps): JSX.Element {
  const typeLabel = questionTypeLabel(model.type);
  const selectedChoices = selectedChoiceLabels(model.answer);
  return (
    <article
      className={
        nested
          ? 'flex flex-col gap-3'
          : 'flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {model.number !== null ? (
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[13px] font-bold text-brand">
            Q{model.number}
          </span>
        ) : null}
        {typeLabel ? <Badge tone="neutral" dot={false}>{typeLabel}</Badge> : null}
        {badges}
        {actions ? (
          <>
            <span className="flex-1" />
            {actions}
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Question {stemAction}</span>
        <div className="text-sm leading-relaxed text-ink"><RenderLatex text={model.stem} /></div>
      </div>

      <FigureGrid urls={model.questionImages} alt="Question figure" />

      {model.match ? <MatchTableView match={model.match} /> : null}

      {model.options.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {model.options.map((option, index) => (
            <OptionRow
              key={`${option.label}-${String(index)}`}
              option={{
                ...option,
                isCorrect: option.isCorrect || selectedChoices.has(option.label.trim().toUpperCase()),
              }}
              action={optionAction?.(index)}
            />
          ))}
        </ul>
      ) : null}

      {(model.answer && model.answer.trim()) || model.answerImages.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-ok/30 bg-ok-soft p-3">
          <div className="flex items-center gap-1.5">
            <span className={FIELD_LABEL}>Answer</span>
            {model.answer && model.answer.trim() ? (
              <Badge tone="success"><RenderLatex text={model.answer} /></Badge>
            ) : null}
            {answerAction}
          </div>
          <FigureGrid urls={model.answerImages} alt="Answer figure" />
        </div>
      ) : null}

      {(model.explanation && model.explanation.trim()) || model.explanationImages.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2 p-3">
          <span className={FIELD_LABEL}>Explanation</span>
          {model.explanation && model.explanation.trim() ? (
            <div className="text-sm leading-relaxed text-ink-2"><RenderLatex text={model.explanation} /></div>
          ) : null}
          <FigureGrid urls={model.explanationImages} alt="Explanation figure" />
        </div>
      ) : null}
    </article>
  );
}
