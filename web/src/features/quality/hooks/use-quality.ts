import {
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AiFillClaim,
  AiFilledSummary,
  AiBatchRequest,
  AiBatchResult,
  AiFixField,
  AiFixSuggestion,
  AiProposal,
  AiProposalPage,
  Anomaly,
  DecideProposals,
  DecideProposalsResult,
  AnomalyPage,
  BulkFixPlanId,
  BulkFixPreview,
  BulkFixResult,
  FixQueuePage,
  FixResult,
  FixTarget,
  QualityFilterOptions,
  QualityScan,
  QualityScanList,
  QualitySummary,
  QuestionFix,
  UpdateAnomaly,
} from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { qualityApi } from '../api/quality.api.js';
import type { QualityFilterState, QualitySelection } from '../types.js';

/** Every quality query sits under this key, so a scan or a status change refreshes them all at once. */
const QUALITY_KEY = ['quality'] as const;

/** The shape react-query caches the fix queue under — the pages plus their cursors. */
type FixQueueData = { pages: FixQueuePage[]; pageParams: unknown[] };

/**
 * How long counts may sit unrefreshed. Fixes land continuously (a scan, a bulk plan, another operator), so
 * a tile showing a number nobody can reproduce is worse than a background request every half minute.
 */
const REFRESH_MS = 30_000;

/** Dashboard totals, per-rule counts, filter values, and the last scan. */
export function useQualitySummary(): UseQueryResult<QualitySummary> {
  return useQuery({
    queryKey: [...QUALITY_KEY, 'summary'],
    queryFn: () => qualityApi.summary(),
    refetchInterval: REFRESH_MS,
  });
}

/** The anomaly list: one cursor page per fetch, keyed by the whole selection. */
export function useAnomalies(filters: QualityFilterState): UseInfiniteQueryResult<{ pages: AnomalyPage[] }> {
  return useInfiniteQuery({
    queryKey: [...QUALITY_KEY, 'anomalies', filters],
    queryFn: ({ pageParam }) => qualityApi.anomalies(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Recent scan runs, newest first. */
export function useQualityScans(): UseQueryResult<QualityScanList> {
  return useQuery({ queryKey: [...QUALITY_KEY, 'scans'], queryFn: () => qualityApi.scans() });
}

/**
 * The exam/subject/chapter values worth offering for the current selection. Each set is narrowed by the
 * other choices, so picking JEE shrinks the subjects and chapters to the ones that actually have problems.
 */
export function useQualityFilterOptions(selection: QualitySelection): UseQueryResult<QualityFilterOptions> {
  return useQuery({
    queryKey: [...QUALITY_KEY, 'filter-options', selection],
    queryFn: () => qualityApi.filterOptions(selection),
    staleTime: 5 * 60 * 1000,
  });
}

/** The fix queue: one row per affected question, cursor-paged like the anomaly list. */
export function useFixQueue(filters: QualityFilterState): UseInfiniteQueryResult<{ pages: FixQueuePage[] }> {
  return useInfiniteQuery({
    queryKey: [...QUALITY_KEY, 'fix-queue', filters],
    queryFn: ({ pageParam }) => qualityApi.fixQueue(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: REFRESH_MS,
  });
}

/** The selected question's current values and open anomalies; idle while nothing is selected. */
export function useFixTarget(questionId: string | null): UseQueryResult<FixTarget> {
  return useQuery({
    queryKey: [...QUALITY_KEY, 'fix', questionId],
    queryFn: () => qualityApi.fixTarget(questionId ?? ''),
    enabled: questionId !== null,
  });
}

/**
 * Save a correction. The response already carries the re-checked question, so it is written straight into
 * this question's cache; the queue and counts are refreshed in the background.
 */
export function useApplyFix(): UseMutationResult<FixResult, Error, { questionId: string; fix: QuestionFix; ai?: AiFillClaim | undefined }> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: ({ questionId, fix, ai }) => qualityApi.applyFix(questionId, fix, ai),
    onSuccess: (result, { questionId }) => {
      queryClient.setQueryData([...QUALITY_KEY, 'fix', questionId], result.target);
      // A question with nothing left open has no place in a queue of open problems: drop its row at once
      // rather than leaving it there, looking unfixed, until the next refetch.
      if (result.remaining === 0) {
        queryClient.setQueriesData<FixQueueData>({ queryKey: [...QUALITY_KEY, 'fix-queue'] }, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => {
                  const kept = page.items.filter((item) => item.questionId !== questionId);
                  return kept.length === page.items.length
                    ? page
                    : { ...page, items: kept, total: Math.max(0, page.total - 1) };
                }),
              }
            : data,
        );
      }
      success(
        result.resolved > 0 ? `Fixed ${String(result.resolved)} problem(s)` : 'Saved',
        result.remaining > 0 ? `${String(result.remaining)} still open on this question` : 'Nothing left open on this question',
      );
    },
    onError: (err) => { error('Could not save the fix', err.message); },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'summary'] });
      void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'fix-queue'] });
      void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'anomalies'] });
      void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'ai-filled'] });
    },
  });
}

/**
 * How many live questions hold AI-written data. A whole-bank count, so it is refreshed on the slow cycle
 * and after anything that can change it (a save, an approval), not on every summary poll.
 */
export function useAiFilledSummary(): UseQueryResult<AiFilledSummary> {
  return useQuery({
    queryKey: [...QUALITY_KEY, 'ai-filled'],
    queryFn: () => qualityApi.aiFilledSummary(),
    staleTime: 60_000,
  });
}

/**
 * Ask the AI for one question's topic / answer / solution / level. Nothing is written — the result goes
 * into the panel's form, and the operator saves it like any other correction.
 */
export function useAiFix(): UseMutationResult<AiFixSuggestion, Error, { questionId: string; fields: AiFixField[]; respectType?: boolean }> {
  const { error } = useToast();
  return useMutation({
    mutationFn: ({ questionId, fields, respectType }) => qualityApi.aiFix(questionId, fields, respectType),
    onError: (err) => { error('AI fix failed', err.message); },
  });
}

/** Proposals awaiting a decision (or already decided), newest first. */
export function useAiProposals(
  status: AiProposal['status'],
  needsDecision = false,
): UseInfiniteQueryResult<{ pages: AiProposalPage[] }> {
  return useInfiniteQuery({
    queryKey: [...QUALITY_KEY, 'proposals', status, needsDecision],
    queryFn: ({ pageParam }) => qualityApi.proposals(status, pageParam, needsDecision),
    // Switching between "all" and "needs your decision" keeps the current list on screen until the other loads.
    placeholderData: (previous) => previous,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Run the AI over one slice of the selection. The caller loops this with the returned cursor, so a long run
 * is a series of short requests it can show progress for and stop between.
 */
export function useAiBatch(): UseMutationResult<AiBatchResult, Error, AiBatchRequest> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: (body) => qualityApi.aiBatch(body),
    onError: (err) => { error('AI run failed', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'proposals'] }); },
  });
}

/** Approve or decline proposals. Approving is what writes the bank, so every quality view is refreshed. */
export function useDecideProposals(): UseMutationResult<DecideProposalsResult, Error, DecideProposals> {
  const queryClient = useQueryClient();
  const { toast, success, error } = useToast();
  return useMutation({
    mutationFn: (body) => qualityApi.decideProposals(body),
    onSuccess: (result) => {
      if (result.conflicts > 0) {
        toast({
          tone: 'info',
          title: `${result.conflicts.toLocaleString()} left for you to decide`,
          description: `Their answer does not fit the question type or options, so they were not applied${result.applied > 0 ? ` (${result.applied.toLocaleString()} others were)` : ''}. Resolve them on their cards.`,
        });
        return;
      }
      if (result.applied > 0) {
        success(
          `Applied ${result.applied.toLocaleString()} question${result.applied === 1 ? '' : 's'}`,
          result.failed > 0 ? `${String(result.failed)} could not be written` : 'Written to the bank and its staging copies.',
        );
      } else if (result.rejected > 0) {
        success(`Declined ${result.rejected.toLocaleString()} proposal${result.rejected === 1 ? '' : 's'}`);
      }
    },
    onError: (err) => { error('Could not apply the proposals', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: QUALITY_KEY }); },
  });
}

/**
 * Re-ask the AI for one proposal with its question type confirmed — the fix for an answer that did not fit
 * (two answers on a single-correct question). The fresh proposal replaces the old one, still pending.
 */
export function useRetryProposal(): UseMutationResult<AiProposal, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id) => qualityApi.retryProposal(id),
    onSuccess: (proposal) => {
      if (proposal.answerWarnings.length > 0) {
        error('The AI still disagrees with the type', 'Its new answer does not fit either — pick the answer yourself, or correct the type.');
      } else {
        success('New answer ready', `The AI now answers ${proposal.answer ?? '—'}. Check it, then apply.`);
      }
    },
    onError: (err) => { error('Could not re-ask the AI', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: [...QUALITY_KEY, 'proposals'] }); },
  });
}

/** The rule-only fixes with their counts and before/after samples. Recomputed from the bank on each load. */
export function useBulkFixes(): UseQueryResult<BulkFixPreview> {
  return useQuery({ queryKey: [...QUALITY_KEY, 'bulk-fixes'], queryFn: () => qualityApi.bulkFixes() });
}

/** Apply one bulk plan. A scan afterwards is what refreshes the anomaly counts. */
export function useApplyBulkFix(): UseMutationResult<BulkFixResult, Error, BulkFixPlanId> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (plan) => qualityApi.applyBulkFix(plan),
    onSuccess: (result) => {
      success(`Fixed ${result.applied.toLocaleString()} questions`, 'Run a scan to refresh the counts.');
    },
    onError: (err) => { error('Bulk fix failed', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: QUALITY_KEY }); },
  });
}

/** Run a scan now, then refresh every quality view with the reconciled result. */
export function useRunQualityScan(): UseMutationResult<QualityScan, Error, void> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: () => qualityApi.runScan(),
    onSuccess: (scan) => {
      success(
        'Scan complete',
        `${scan.questionsScanned.toLocaleString()} live questions · ${scan.opened.toLocaleString()} new · ` +
          `${scan.reopened.toLocaleString()} reopened · ${scan.resolved.toLocaleString()} resolved` +
          (scan.removed > 0 ? ` · ${scan.removed.toLocaleString()} removed (no longer live)` : ''),
      );
    },
    onError: (err) => { error('Scan failed', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: QUALITY_KEY }); },
  });
}

/**
 * Ignore or reopen one anomaly. Refetches rather than patching the cache: the row leaves the current
 * status tab and every count in the summary moves, so the server's view is the simplest truth.
 */
export function useUpdateAnomaly(): UseMutationResult<Anomaly, Error, { id: string; update: UpdateAnomaly }> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: ({ id, update }) => qualityApi.updateAnomaly(id, update),
    onError: (err) => { error('Could not update the anomaly', err.message); },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: QUALITY_KEY }); },
  });
}
