import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type {
  BatchUpdateQuestionsResult,
  Passage,
  Question,
  QuestionBatchUpdate,
  QuestionListResponse,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';

/** The one spelling of the questions cache key — every reader and writer must agree on it. */
export function questionsQueryKey(documentId: string | null): ['questions', string | null] {
  return ['questions', documentId];
}

/**
 * The document's verify read — questions + their comprehension passages — is fetched once and cached
 * under {@link questionsQueryKey}. {@link useQuestions} and {@link usePassages} both read that one
 * cache entry (react-query dedupes the fetch by key), each selecting its slice.
 */

/** Loads the questions extracted from a document; idle until a document is selected. */
export function useQuestions(documentId: string | null): UseQueryResult<Question[]> {
  return useQuery({
    queryKey: questionsQueryKey(documentId),
    queryFn: () => questionsApi.listByDocument(documentId ?? ''),
    enabled: documentId !== null,
    select: (response: QuestionListResponse) => response.questions,
  });
}

/** Loads the comprehension passages for a document (empty when it has no groups); shares the cache above. */
export function usePassages(documentId: string | null): UseQueryResult<Passage[]> {
  return useQuery({
    queryKey: questionsQueryKey(documentId),
    queryFn: () => questionsApi.listByDocument(documentId ?? ''),
    enabled: documentId !== null,
    select: (response: QuestionListResponse) => response.passages,
  });
}

/** How many pages the document's source PDF has (drives the page selector). */
export function usePageCount(documentId: string | null): UseQueryResult<number> {
  return useQuery({
    queryKey: ['page-count', documentId],
    queryFn: () => questionsApi.pageCount(documentId ?? ''),
    enabled: documentId !== null,
  });
}

/** Publishes a document's questions into the main bank, then refreshes documents + sessions. */
export function usePublishDocument(): UseMutationResult<{ published: number }, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (documentId: string) => questionsApi.publishDocument(documentId),
    onSuccess: (result) => {
      success('Published to bank', `${String(result.published)} question(s) are now live.`);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => { error('Publish failed', err.message); },
  });
}

/** Pushes several questions' verify edits in one call, then refreshes the document's questions. */
export function useBatchUpdateQuestions(
  documentId: string,
): UseMutationResult<BatchUpdateQuestionsResult, Error, QuestionBatchUpdate[]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: QuestionBatchUpdate[]) => questionsApi.batchUpdate(updates),
    onSuccess: (result) => {
      // Merge the saved rows in place first: the caller clears its drafts as soon as this mutation
      // resolves, and without this the cards would show the stale pre-edit rows until the refetch
      // lands. Text edits never change a question's sort keys, so in-place mapping keeps the order.
      queryClient.setQueryData<QuestionListResponse>(questionsQueryKey(documentId), (prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map(
                (question) => result.updated.find((u) => u.id === question.id) ?? question,
              ),
            }
          : prev,
      );
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) });
    },
  });
}

/** Applies verify-screen edits to a question and refreshes the document's questions. */
export function useUpdateQuestion(): UseMutationResult<
  Question,
  Error,
  { id: string; patch: UpdateQuestion }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateQuestion }) =>
      questionsApi.update(input.id, input.patch),
    onSuccess: (question) => {
      // Write the fresh question into the cache NOW (before mutateAsync resolves): the verify
      // auto-save pipeline read-modify-writes image lists from this cache, and must never see the
      // pre-patch record while the invalidation refetch is still in flight.
      queryClient.setQueryData<QuestionListResponse>(questionsQueryKey(question.documentId), (prev) =>
        prev
          ? { ...prev, questions: prev.questions.map((q) => (q.id === question.id ? question : q)) }
          : prev,
      );
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(question.documentId) });
    },
  });
}

/** Applies verify-screen edits to a comprehension passage (text / shared image) — the single-place save. */
export function useUpdatePassage(
  documentId: string,
): UseMutationResult<Passage, Error, { id: string; patch: UpdatePassage }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdatePassage }) =>
      questionsApi.updatePassage(input.id, input.patch),
    onSuccess: (passage) => {
      queryClient.setQueryData<QuestionListResponse>(questionsQueryKey(documentId), (prev) =>
        prev
          ? { ...prev, passages: prev.passages.map((p) => (p.id === passage.id ? passage : p)) }
          : prev,
      );
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) });
    },
  });
}

/** Manually group questions into a comprehension (verify "group into comprehension"); refreshes the doc. */
export function useGroupQuestions(documentId: string): UseMutationResult<Passage, Error, string[]> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (questionIds: string[]) => questionsApi.groupQuestions(documentId, questionIds),
    onSuccess: () => {
      success('Grouped into comprehension', 'Re-extract the passage to read it off the page.');
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) });
    },
    onError: (err) => { error('Could not group', err.message); },
  });
}

/** Dissolve a comprehension group back into standalone questions (verify "ungroup"); refreshes the doc. */
export function useUngroupPassage(documentId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (passageId: string) => questionsApi.ungroupPassage(passageId),
    onSuccess: () => {
      success('Ungrouped', 'Those questions are standalone again.');
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) });
    },
    onError: (err) => { error('Could not ungroup', err.message); },
  });
}
