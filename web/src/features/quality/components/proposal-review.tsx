import { type JSX, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AiProposal, DecideProposals, FixTarget } from '@ingest/contracts';
import { RenderLatex } from '../../../shared/lib/latex.js';
import {
  Badge,
  Button,
  EmptyState,
  IconCheck,
  IconSparkle,
  IconWarning,
  IconX,
  LoadingState,
  MatchTableView,
  Spinner,
  useConfirm,
} from '../../../shared/ui/index.js';
import { cn } from '../../../shared/lib/cn.js';
import { useAiProposals, useDecideProposals, useFixTarget, useRetryProposal } from '../hooks/use-quality.js';
import { clampLatex } from '../lib/anomaly-display.js';

/** The bar above which a proposal is trusted enough for the one-click approval pass. */
const TRUSTED = 0.8;

/** Types that take exactly one option as the answer — picking a second deselects the first. */
const ONE_ANSWER_TYPES = /single|assertion|one correct|only one|straight objective/i;

/** How a reviewer settled a proposal whose answer did not fit the question. */
type Resolution = NonNullable<DecideProposals['resolve']>;

/** "single_correct" / "SINGLE CORRECT TYPE" → "single correct", for sentences. */
function typeLabel(type: string | null): string {
  return (type ?? 'unknown type').replace(/_/g, ' ').toLowerCase();
}

/** One changed field, as before → after so the decision is about the change, not the field. */
function Change({ label, before, after }: { label: string; before: string | null; after: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 text-sm">
      <span className="pt-0.5 text-xs font-medium text-ink-3">{label}</span>
      <div className="min-w-0">
        {before !== null && before.trim() !== '' ? (
          <div className="text-ink-3 line-through"><RenderLatex text={clampLatex(before, 160)} /></div>
        ) : null}
        <div className="text-ink"><RenderLatex text={after} /></div>
      </div>
    </div>
  );
}

/** "(B) body" → "B"; null for an option string without a label. */
function labelOf(option: string): string | null {
  return /^\s*\(?([A-Za-z0-9]{1,2})[).]\s/.exec(option)?.[1]?.toUpperCase() ?? null;
}

/** "A, C" / "AC" / "(B)" → the labels an answer names. */
function answerLabels(answer: string | null): Set<string> {
  if (answer === null) return new Set();
  const parts = answer.toUpperCase().match(/[A-Z]|\d+/g) ?? [];
  return new Set(parts);
}

/**
 * The whole question as the bank holds it right now — passage, text, figure and every option — so a proposed
 * answer is checked against the question itself rather than a two-line teaser. Options the proposal picks are
 * highlighted; the ones the stored answer picks are marked too, so a disagreement is visible at a glance.
 */
function QuestionBody({
  proposal,
  target,
  picked,
}: {
  proposal: AiProposal;
  target: UseQueryResult<FixTarget>;
  /** Labels the reviewer picked while resolving a conflict (uppercase). */
  picked: ReadonlySet<string>;
}): JSX.Element {
  if (target.isPending) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-3">
        <Spinner /> Loading the question…
      </div>
    );
  }
  if (target.isError) {
    // The question may have been deleted since the run; the preview is all that is left to show.
    return (
      <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
        <RenderLatex text={proposal.preview} />
        <p className="m-0 mt-1 text-xs text-bad">Could not load the full question: {target.error.message}</p>
      </div>
    );
  }

  const question = target.data;
  const proposed = answerLabels(proposal.answer);
  const stored = answerLabels(question.answer);
  return (
    <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
      <div className="flex flex-wrap gap-1.5 text-xs text-ink-3">
        {question.questionType ? <Badge tone="neutral">{question.questionType}</Badge> : null}
        {question.exam ? <span>{question.exam}</span> : null}
        {question.topic ? <span>· {question.topic}</span> : null}
      </div>
      {question.passage ? (
        <div className="border-l-2 border-line pl-2 text-ink-2"><RenderLatex text={question.passage} /></div>
      ) : null}
      <div><RenderLatex text={question.questionText} /></div>
      {question.questionImage ? (
        <img src={question.questionImage} alt="Question figure" className="max-h-60 w-auto self-start rounded border border-line bg-white" />
      ) : null}
      {question.options.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {question.options.map((option, index) => {
            const label = labelOf(option);
            const isProposed = label !== null && proposed.has(label);
            const isStored = label !== null && stored.has(label);
            const isPicked = label !== null && picked.has(label);
            return (
              <li
                key={index}
                className={cn(
                  'flex items-start gap-2 rounded-md border px-2 py-1',
                  isPicked ? 'border-brand bg-brand-soft' : isProposed ? 'border-ok/40 bg-ok-soft' : 'border-transparent',
                )}
              >
                <span className="min-w-0 flex-1"><RenderLatex text={option} /></span>
                {isPicked ? <span className="flex-none text-xs font-semibold text-brand">your pick</span> : null}
                {isProposed ? <span className="flex-none text-xs font-semibold text-ok">AI answer</span> : null}
                {isStored ? <span className="flex-none text-xs text-ink-3">stored answer</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {question.optionImages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {question.optionImages.map((src, index) => (
            <img key={index} src={src} alt={`Option figure ${String(index + 1)}`} className="max-h-32 w-auto rounded border border-line bg-white" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Shown when the AI's answer does not fit the question as stored (two answers on a single-correct question,
 * a label the options do not have). The proposal cannot be applied as-is; the reviewer settles it one of three
 * ways: re-ask the AI with the type confirmed, pick the answer themselves, or correct the type.
 */
function ConflictPanel({
  proposal,
  optionLabels,
  picked,
  busy,
  onPick,
  onResolve,
}: {
  proposal: AiProposal;
  /** The question's option labels in order (uppercase); empty until the question loads or when it has none. */
  optionLabels: string[];
  picked: ReadonlySet<string>;
  busy: boolean;
  onPick: (label: string) => void;
  onResolve: (resolution: Resolution) => void;
}): JSX.Element {
  const retry = useRetryProposal();
  const type = typeLabel(proposal.questionType);
  const severalOnSingle = proposal.answerWarnings.some((warning) => warning.kind === 'single_correct_multiple_answers');
  const doubts = [...proposal.answerWarnings.map((warning) => warning.detail), ...proposal.structureWarnings];
  const pickedAnswer = optionLabels.filter((label) => picked.has(label)).join(', ');
  const working = busy || retry.isPending;

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2 text-warn [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:flex-none">
        <IconWarning />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">
            {proposal.answerWarnings.length > 0
              ? "The AI's answer does not fit this question — check it before applying"
              : 'Check the rebuilt structure before applying'}
          </span>
          {doubts.map((doubt) => (
            <span key={doubt} className="text-ink-2">{doubt}</span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-warn/30 pt-2">
        {proposal.answerWarnings.length === 0 ? (
          <span className="text-xs text-ink-2">
            Applying writes the rebuilt structure as it is shown below. If it is wrong, discard the proposal and fix the
            question in Verify, where the table can be edited by hand.
          </span>
        ) : null}
        {proposal.answerWarnings.length > 0 && proposal.questionType !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="primary"
              disabled={working}
              title={`Run the AI again, telling it the question is confirmed ${type} so its answer must fit`}
              onClick={() => { retry.mutate(proposal.id); }}
            >
              {retry.isPending ? <Spinner /> : <IconSparkle />}
              {retry.isPending ? 'Asking the AI…' : `It is ${type} — ask the AI again`}
            </Button>
            <span className="text-xs text-ink-3">Replaces this proposal with a new answer and solution for you to review.</span>
          </div>
        ) : null}

        {proposal.answerWarnings.length > 0 && optionLabels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-ink-2">Or pick the answer yourself:</span>
            {optionLabels.map((label) => (
              <button
                key={label}
                type="button"
                disabled={working}
                aria-pressed={picked.has(label)}
                onClick={() => { onPick(label); }}
                className={cn(
                  'min-w-8 cursor-pointer rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed',
                  picked.has(label) ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:border-brand',
                )}
              >
                {label}
              </button>
            ))}
            <Button
              size="xs"
              disabled={working || pickedAnswer === ''}
              title="Apply the proposal with this answer instead of the AI's. The answer is saved as yours, not tagged as AI-filled."
              onClick={() => { onResolve({ answer: pickedAnswer }); }}
            >
              <IconCheck /> {pickedAnswer === '' ? 'Apply with my answer' : `Apply with ${pickedAnswer}`}
            </Button>
          </div>
        ) : null}

        {severalOnSingle && proposal.answer !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              disabled={working}
              title="The question really has several correct options: change its type to multi correct and apply the AI's answer"
              onClick={() => { onResolve({ questionType: 'multi_correct' }); }}
            >
              <IconCheck /> It is multi correct — change the type and apply {proposal.answer}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * What the AI rebuilt of the question's shape, shown as it will look once applied: a real match table, or the
 * recovered passage. This is the whole point of reviewing a structure fix — a table is impossible to judge as
 * JSON and obvious to judge as a table.
 */
function StructureProposal({ proposal }: { proposal: AiProposal }): JSX.Element | null {
  const structure = proposal.structure;
  if (structure === null) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-3">
        {structure.match !== null ? 'Match table the AI rebuilt' : 'Passage the AI recovered'}
      </span>
      {structure.match !== null ? (
        <div className="rounded-lg border border-line p-2">
          <MatchTableView match={structure.match} />
        </div>
      ) : null}
      {structure.passage !== null ? (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
          <RenderLatex text={structure.passage} />
        </div>
      ) : null}
    </div>
  );
}

function ProposalCard({
  proposal,
  selected,
  busy,
  onToggle,
  onDecide,
}: {
  proposal: AiProposal;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onDecide: (action: 'apply' | 'reject', resolve?: Resolution) => void;
}): JSX.Element {
  const target = useFixTarget(proposal.questionId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const conflicted = proposal.answerWarnings.length + proposal.structureWarnings.length > 0;
  const tone = proposal.confidence >= TRUSTED ? 'success' : proposal.confidence >= 0.5 ? 'progress' : 'danger';
  const optionLabels = (target.data?.options ?? []).map(labelOf).filter((label): label is string => label !== null);
  const oneAnswer = ONE_ANSWER_TYPES.test(proposal.questionType ?? '');

  const pick = (label: string): void => {
    setPicked((prev) => {
      if (prev.has(label)) return new Set([...prev].filter((current) => current !== label));
      return oneAnswer ? new Set([label]) : new Set([...prev, label]);
    });
  };

  return (
    <article
      className={cn(
        'flex gap-3 rounded-xl border bg-surface p-4 shadow-sm',
        selected ? 'border-brand ring-2 ring-brand-soft' : conflicted ? 'border-warn/50' : 'border-line',
      )}
    >
      <input
        type="checkbox"
        className="mt-1 size-4 w-auto flex-none accent-brand"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select proposal for ${proposal.questionId}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{Math.round(proposal.confidence * 100)}%</Badge>
          {proposal.usedImage ? <Badge tone="info">read the figure</Badge> : null}
          {conflicted ? <Badge tone="progress">needs your decision</Badge> : null}
          <span className="text-xs text-ink-3">
            {[proposal.subject, proposal.chapter, proposal.questionNumber !== null ? `Q${String(proposal.questionNumber)}` : null]
              .filter(Boolean)
              .join(' · ') || 'Untagged question'}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="xs" disabled={busy} onClick={() => { onDecide('reject'); }}>
            <IconX /> Discard
          </Button>
          <Button
            size="xs"
            disabled={busy || conflicted}
            title={conflicted ? 'The answer does not fit the question — resolve it below first' : undefined}
            onClick={() => { onDecide('apply'); }}
          >
            <IconCheck /> Apply
          </Button>
        </header>

        {conflicted ? (
          <ConflictPanel
            proposal={proposal}
            optionLabels={optionLabels}
            picked={picked}
            busy={busy}
            onPick={pick}
            onResolve={(resolution) => { onDecide('apply', resolution); }}
          />
        ) : null}

        <div className="grid grid-cols-2 items-start gap-3 max-[1000px]:grid-cols-1">
          <QuestionBody proposal={proposal} target={target} picked={picked} />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Proposed by the AI</span>
            {proposal.topic !== null ? <Change label="Topic" before={proposal.currentTopic} after={proposal.topic} /> : null}
            {proposal.answer !== null ? <Change label="Answer" before={proposal.currentAnswer} after={proposal.answer} /> : null}
            {proposal.level !== null ? <Change label="Level" before={proposal.currentLevel} after={proposal.level} /> : null}
            {proposal.solution !== null ? <Change label="Solution" before={null} after={proposal.solution} /> : null}
            <StructureProposal proposal={proposal} />
            {proposal.notes.trim() !== '' ? <p className="m-0 mt-1 text-xs text-ink-2">{proposal.notes}</p> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The review list: everything the AI has proposed, waiting for a decision. Approving writes the question
 * exactly as a manual correction would (bank + staging, then re-checked); declining leaves it untouched.
 */
export function ProposalReview(): JSX.Element {
  // "Needs your decision" narrows the list (server-side, across every page) to the proposals whose answer does
  // not fit their question, so they can be worked through one after another.
  const [onlyDecisions, setOnlyDecisions] = useState(false);
  const query = useAiProposals('pending', onlyDecisions);
  const decide = useDecideProposals();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, confirmDialog] = useConfirm();

  const showOnlyDecisions = (on: boolean): void => {
    setOnlyDecisions(on);
    setSelected(new Set());
  };

  if (query.isPending) return <LoadingState label="Loading proposals…" />;
  if (query.isError) return <p className="error">Could not load the proposals: {query.error.message}</p>;

  const proposals = query.data.pages.flatMap((page) => page.proposals);
  const total = query.data.pages[0]?.total ?? 0;
  const needsDecision = query.data.pages[0]?.needsDecision ?? 0;
  if (proposals.length === 0) {
    return onlyDecisions ? (
      <EmptyState
        icon={<IconCheck />}
        title="Nothing needs your decision"
        body="Every answer the AI proposed fits its question. The rest are ready to review and apply."
        action={<Button size="xs" onClick={() => { showOnlyDecisions(false); }}>Show all proposals</Button>}
      />
    ) : (
      <EmptyState
        title="No proposals waiting"
        body="Run the AI over a filtered set above. Everything it works out waits here until you approve it."
      />
    );
  }

  // Conflicted proposals are skipped by every bulk apply (the server enforces it too), so they are not counted.
  const trusted = proposals.filter(
    (proposal) => proposal.confidence >= TRUSTED && proposal.answerWarnings.length + proposal.structureWarnings.length === 0,
  ).length;

  /** Throw the whole waiting set away. Confirmed, because a long run's worth of work disappears with it. */
  const discardAll = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Discard all ${total.toLocaleString()} proposals?`,
      body: 'Nothing is written to the bank and the questions stay exactly as they are. You would need to run the AI again to get these back.',
      confirmLabel: 'Discard them',
      tone: 'danger',
    });
    if (confirmed) decide.mutate({ action: 'reject', minConfidence: 0 }, { onSuccess: () => { setSelected(new Set()); } });
  };

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">
          {onlyDecisions
            ? `${needsDecision.toLocaleString()} need${needsDecision === 1 ? 's' : ''} your decision`
            : `${total.toLocaleString()} waiting for review`}
        </span>
        {needsDecision > 0 || onlyDecisions ? (
          <button
            type="button"
            aria-pressed={onlyDecisions}
            title={onlyDecisions ? 'Show every proposal again' : 'Show only the proposals whose answer does not fit the question'}
            onClick={() => { showOnlyDecisions(!onlyDecisions); }}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors [&>svg]:size-3.5',
              onlyDecisions
                ? 'border-warn bg-warn text-white hover:opacity-90'
                : 'border-warn/40 bg-warn-soft text-warn hover:border-warn',
            )}
          >
            {onlyDecisions ? <IconX /> : <IconWarning />}
            {onlyDecisions ? 'Show all proposals' : `${needsDecision.toLocaleString()} need your decision — fix them`}
          </button>
        ) : null}
        <span className="flex-1" />
        {decide.isPending || query.isPlaceholderData ? <Spinner className="text-ink-3" /> : null}
        {onlyDecisions ? null : (
          // Hidden while narrowed: "all" would also discard the proposals this view is not showing.
          <Button
            variant="ghost"
            size="xs"
            disabled={decide.isPending}
            title="Throw away every proposal waiting here. The questions are left exactly as they are."
            onClick={() => { void discardAll(); }}
          >
            Discard all
          </Button>
        )}
        <Button
          size="xs"
          disabled={decide.isPending || selected.size === 0}
          title={selected.size === 0 ? 'Tick the proposals you want to discard' : undefined}
          onClick={() => { decide.mutate({ action: 'reject', ids: [...selected] }, { onSuccess: () => { setSelected(new Set()); } }); }}
        >
          Discard {selected.size > 0 ? selected.size.toLocaleString() : 'selected'}
        </Button>
        <Button
          size="xs"
          disabled={decide.isPending || selected.size === 0}
          title={selected.size === 0 ? 'Tick the proposals you want to apply' : undefined}
          onClick={() => { decide.mutate({ action: 'apply', ids: [...selected] }, { onSuccess: () => { setSelected(new Set()); } }); }}
        >
          Apply {selected.size > 0 ? selected.size.toLocaleString() : 'selected'}
        </Button>
        {onlyDecisions ? null : (
          // Hidden while narrowed: nothing in this view can be applied in bulk.
          <Button
            variant="primary"
            size="xs"
            disabled={decide.isPending || trusted === 0}
            title={`Applies every pending proposal at ${String(Math.round(TRUSTED * 100))}% confidence or above, except those that need your decision`}
            onClick={() => { decide.mutate({ action: 'apply', minConfidence: TRUSTED }); }}
          >
            Apply all ≥ {Math.round(TRUSTED * 100)}% ({trusted.toLocaleString()})
          </Button>
        )}
      </div>

      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          selected={selected.has(proposal.id)}
          busy={decide.isPending}
          onToggle={() => { toggle(proposal.id); }}
          onDecide={(action, resolve) => { decide.mutate({ action, ids: [proposal.id], ...(resolve && { resolve }) }); }}
        />
      ))}

      {query.hasNextPage ? (
        <Button className="self-center" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
      {confirmDialog}
    </div>
  );
}
