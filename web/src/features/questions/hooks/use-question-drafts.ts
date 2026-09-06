import { useMemo, useState } from 'react';
import type { MatchData, Question, QuestionBatchUpdate, QuestionOption, UpdateQuestion } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { useBatchUpdateQuestions } from './use-questions.js';

/** The locally edited text fields of one question — everything the verify card changes offline. */
export type QuestionDraft = {
  stem: string;
  answer: string;
  explanation: string;
  /**
   * The shared comprehension passage (BLA-125), edited once on the group panel and fanned across
   * every sibling's draft so they save identically. Empty on a non-comprehension question.
   */
  passage: string;
  questionType: string;
  sectionName: string;
  topic: string;
  /** Per-question PYQ exam/year (blank on a non-PYQ chapter); edited on a PYQ chapter's verify card. */
  pyqExam: string;
  pyqYear: string;
  options: QuestionOption[];
  /** Structured match-the-column data (columns + key) for MATRIX questions; null for every other. */
  match: MatchData | null;
};

/** Document-level fallbacks shown (and saved on first edit) when the question's own field is blank. */
type DraftFallbacks = {
  questionType: string | null;
  sectionName: string | null;
  pyqExam: string | null;
  pyqYear: string | null;
};

function toQuestionDraft(question: Question, fallbacks: DraftFallbacks): QuestionDraft {
  return {
    stem: question.stem,
    answer: question.answer,
    explanation: question.explanation ?? '',
    passage: question.passage ?? '',
    questionType: question.questionType ?? fallbacks.questionType ?? '',
    sectionName: question.sectionName ?? fallbacks.sectionName ?? '',
    topic: question.topic ?? '',
    pyqExam: question.pyqExam ?? fallbacks.pyqExam ?? '',
    pyqYear: question.pyqYear ?? fallbacks.pyqYear ?? '',
    options: question.options.map((option) => ({ ...option })),
    match: question.match,
  };
}

function optionEquals(a: QuestionOption, b: QuestionOption): boolean {
  return a.label === b.label && a.body === b.body && a.isCorrect === b.isCorrect;
}

/** Deep-compare structured match data. A cheap JSON compare is enough — the shape is small and any
 * false "dirty" only enables Update, never loses an edit. */
function matchEquals(a: MatchData | null, b: MatchData | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function draftEquals(a: QuestionDraft, b: QuestionDraft): boolean {
  return (
    a.stem === b.stem &&
    a.answer === b.answer &&
    a.explanation === b.explanation &&
    a.passage === b.passage &&
    a.questionType === b.questionType &&
    a.sectionName === b.sectionName &&
    a.topic === b.topic &&
    a.pyqExam === b.pyqExam &&
    a.pyqYear === b.pyqYear &&
    matchEquals(a.match, b.match) &&
    a.options.length === b.options.length &&
    a.options.every((option, i) => {
      const other = b.options[i];
      return other !== undefined && optionEquals(option, other);
    })
  );
}

function draftToPatch(draft: QuestionDraft): UpdateQuestion {
  return {
    stem: draft.stem,
    answer: draft.answer,
    explanation: draft.explanation || null,
    passage: draft.passage || null,
    options: draft.options,
    match: draft.match,
    questionType: draft.questionType || null,
    sectionName: draft.sectionName || null,
    topic: draft.topic || null,
    pyqExam: draft.pyqExam || null,
    pyqYear: draft.pyqYear || null,
  };
}

export type QuestionDrafts = {
  /** The question's working copy: the local draft when one exists, else the server truth. */
  draftFor: (question: Question) => QuestionDraft;
  setDraft: (questionId: string, draft: QuestionDraft) => void;
  /**
   * Apply a change computed from the LATEST draft (local edit else server truth), never a stale
   * snapshot. The card's field writes go through this so two AI re-reads resolving out of order can
   * no longer clobber each other — each folds onto the freshest state instead of a captured closure.
   */
  updateDraft: (questionId: string, updater: (prev: QuestionDraft) => QuestionDraft) => void;
  /** Questions whose draft differs from the server — the only ones a save ever sends. */
  dirtyIds: ReadonlySet<string>;
  savingIds: ReadonlySet<string>;
  isSaving: boolean;
  /** Push the dirty questions among `questionIds`; failures stay dirty and are surfaced. */
  save: (questionIds: readonly string[]) => Promise<void>;
};

/**
 * Local-first editing state for the verify workspace: every text edit lands in a per-question
 * draft here (no network), dirtiness is derived by comparing each draft against the server row,
 * and {@link QuestionDrafts.save} pushes ONLY dirty questions through the batch endpoint. On a
 * partial failure the failed questions keep their draft (stay dirty) and the error is toasted;
 * successful ones are cleared — unless the operator kept typing while the save was in flight.
 */
export function useQuestionDrafts(
  documentId: string,
  questions: Question[] | undefined,
  fallbacks: DraftFallbacks,
): QuestionDrafts {
  const [drafts, setDrafts] = useState<Map<string, QuestionDraft>>(new Map());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const batch = useBatchUpdateQuestions(documentId);
  const { success, error } = useToast();

  // Drafts belong to one document; picking another unit must never carry edits across.
  const [scope, setScope] = useState(documentId);
  if (scope !== documentId) {
    setScope(documentId);
    setDrafts(new Map());
    setSavingIds(new Set());
  }

  const { questionType, sectionName, pyqExam, pyqYear } = fallbacks;
  const serverDrafts = useMemo(() => {
    const map = new Map<string, QuestionDraft>();
    for (const question of questions ?? []) {
      map.set(question.id, toQuestionDraft(question, { questionType, sectionName, pyqExam, pyqYear }));
    }
    return map;
  }, [questions, questionType, sectionName, pyqExam, pyqYear]);

  const dirtyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, draft] of drafts) {
      const server = serverDrafts.get(id);
      if (server && !draftEquals(draft, server)) ids.add(id);
    }
    return ids;
  }, [drafts, serverDrafts]);

  const draftFor = (question: Question): QuestionDraft =>
    drafts.get(question.id) ??
    serverDrafts.get(question.id) ??
    toQuestionDraft(question, { questionType, sectionName, pyqExam, pyqYear });

  const setDraft = (questionId: string, draft: QuestionDraft): void => {
    setDrafts((prev) => new Map(prev).set(questionId, draft));
  };

  const updateDraft = (questionId: string, updater: (prev: QuestionDraft) => QuestionDraft): void => {
    setDrafts((prev) => {
      // Base on the freshest state: an in-flight local draft if any, else the server truth. Computed
      // inside the functional update so it can never read a stale render-time snapshot.
      const base = prev.get(questionId) ?? serverDrafts.get(questionId);
      if (!base) return prev;
      return new Map(prev).set(questionId, updater(base));
    });
  };

  const save = async (questionIds: readonly string[]): Promise<void> => {
    const sent = new Map<string, QuestionDraft>();
    const updates: QuestionBatchUpdate[] = [];
    for (const id of questionIds) {
      const draft = drafts.get(id);
      if (!draft || !dirtyIds.has(id)) continue;
      sent.set(id, draft);
      updates.push({ id, patch: draftToPatch(draft) });
    }
    if (updates.length === 0) return;

    setSavingIds((prev) => new Set([...prev, ...sent.keys()]));
    try {
      const result = await batch.mutateAsync(updates);
      setDrafts((prev) => {
        const next = new Map(prev);
        for (const question of result.updated) {
          const sentDraft = sent.get(question.id);
          const current = next.get(question.id);
          if (sentDraft && current && draftEquals(sentDraft, current)) next.delete(question.id);
        }
        return next;
      });
      const firstFailure = result.failed[0];
      if (firstFailure) {
        error(
          `${String(result.failed.length)} of ${String(updates.length)} question(s) failed to save`,
          `They stay marked as edited — fix and retry. First error: ${firstFailure.message}`,
        );
      } else {
        success('Saved', `${String(result.updated.length)} question(s) updated.`);
      }
    } catch (caught) {
      error('Save failed', caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        for (const id of sent.keys()) next.delete(id);
        return next;
      });
    }
  };

  return { draftFor, setDraft, updateDraft, dirtyIds, savingIds, isSaving: batch.isPending, save };
}
