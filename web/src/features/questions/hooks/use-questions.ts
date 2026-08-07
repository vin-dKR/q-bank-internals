import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type {
  BatchUpdateQuestionsResult,
  Question,
  QuestionBatchUpdate,
  UpdateQuestion,
} from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { questionsApi } from '../api/questions.api.js';

/** Loads the questions extracted from a document; idle until a document is selected. */
export function useQuestions(documentId: string | null): UseQueryResult<Question[]> {
  return useQuery({
    queryKey: ['questions', documentId],
    queryFn: () => questionsApi.listByDocument(documentId ?? ''),
    enabled: documentId !== null,
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
      queryClient.setQueryData<Question[]>(['questions', documentId], (prev) =>
        prev?.map((question) => result.updated.find((u) => u.id === question.id) ?? question),
      );
      void queryClient.invalidateQueries({ queryKey: ['questions', documentId] });
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
      void queryClient.invalidateQueries({ queryKey: ['questions', question.documentId] });
    },
  });
}
