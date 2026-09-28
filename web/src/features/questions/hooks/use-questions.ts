import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import type {
  BatchUpdateQuestionsResult,
  Document,
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
export function usePublishDocument(): UseMutationResult<{ published: number }, Error, string, { updating: boolean }> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (documentId: string) => questionsApi.publishDocument(documentId),
    onMutate: (documentId) => ({
      updating: queryClient.getQueryData<Document>(['document', documentId])?.status === 'published',
    }),
    onSuccess: (result, documentId, context) => {
      success(context.updating ? 'Bank updated' : 'Published to bank',
        result.published === 0 ? 'The bank is already up to date.' : `${String(result.published)} question(s) ${context.updating ? 'updated in the bank' : 'are now live'}.`);
      void queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['bank-search'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-filter-options'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err, _documentId, context) => { error(context?.updating ? 'Bank update failed' : 'Publish failed', err.message); },
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
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', documentId] });
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
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', question.documentId] });
    },
  });
}

type ImageModeKey = 'isQuestionImage' | 'isOptionImage';
type ImageModeInput = { id: string; documentId: string; key: ImageModeKey; value: boolean };
type ImageModeContext = { previousValue: boolean | undefined; revision: number };

function imageModeWriteKey(input: Pick<ImageModeInput, 'id' | 'key'>): string {
  return `${input.id}:${input.key}`;
}

// A rapid series of checkbox clicks must reach the API in click order. Keeping
// the queue per question + field lets Question images and Option images save
// independently without allowing an older request to overwrite a newer intent.
const imageModeWrites = new Map<string, Promise<void>>();
const confirmedImageModes = new Map<string, boolean>();
const imageModeRevisions = new Map<string, number>();
function queueImageModeWrite(input: ImageModeInput): Promise<Question> {
  const queueKey = imageModeWriteKey(input);
  const previous = imageModeWrites.get(queueKey) ?? Promise.resolve();
  const request = previous
    .catch(() => undefined)
    .then(async () => {
      const question = await questionsApi.update(input.id, { [input.key]: input.value });
      // This only runs in the serialized request order. A later optimistic intent may already be
      // visible in the cache, but this remains the authoritative fallback if that later write fails.
      confirmedImageModes.set(queueKey, question[input.key]);
      return question;
    });
  imageModeWrites.set(queueKey, request.then(() => undefined, () => undefined));
  return request;
}

/**
 * Fast, field-level image-mode toggle. Unlike the general PATCH hook, this
 * updates only its boolean in the cache and skips a full refetch, so enabling a
 * figure target mounts its controls instantly while the write completes.
 */
export function useSetQuestionImageMode(): UseMutationResult<Question, Error, ImageModeInput, ImageModeContext> {
  const queryClient = useQueryClient();
  const { error } = useToast();
  return useMutation({
    mutationFn: queueImageModeWrite,
    onMutate: (input) => {
      const key = questionsQueryKey(input.documentId);
      // Start cancelling an in-flight fetch, but never make visual feedback wait for it. The card
      // also owns a local-first flag, so the toggle mounts/unmounts its figure controls synchronously.
      void queryClient.cancelQueries({ queryKey: key });
      let previousValue: boolean | undefined;
      queryClient.setQueryData<QuestionListResponse>(key, (previous) =>
        previous
          ? {
              ...previous,
              questions: previous.questions.map((question) => {
                if (question.id !== input.id) return question;
                previousValue = question[input.key];
                return { ...question, [input.key]: input.value };
              }),
            }
          : previous,
      );
      const writeKey = imageModeWriteKey(input);
      if (!confirmedImageModes.has(writeKey)) {
        confirmedImageModes.set(writeKey, previousValue ?? !input.value);
      }
      const revision = (imageModeRevisions.get(writeKey) ?? 0) + 1;
      imageModeRevisions.set(writeKey, revision);
      return { previousValue, revision };
    },
    onError: (caught, input, context) => {
      const key = questionsQueryKey(input.documentId);
      const writeKey = imageModeWriteKey(input);
      // Never let a failed older click roll back a newer queued intent. If the newest click fails,
      // restore the last value the serialized API queue actually confirmed — not merely the previous
      // optimistic value, which may itself have failed.
      if (context && imageModeRevisions.get(writeKey) === context.revision) {
        const confirmed = confirmedImageModes.get(writeKey) ?? context.previousValue ?? !input.value;
        queryClient.setQueryData<QuestionListResponse>(key, (previous) =>
          previous
            ? {
                ...previous,
                questions: previous.questions.map((question) =>
                  question.id === input.id ? { ...question, [input.key]: confirmed } : question,
                ),
              }
            : previous,
        );
      }
      error('Could not update image mode', caught.message);
    },
    onSettled: (_result, _error, input, context) => {
      const writeKey = imageModeWriteKey(input);
      // Once the most recent intent has settled, a later click will seed fresh state from the cache.
      // This keeps the little per-field queue bounded for long Verify sessions.
      if (context && imageModeRevisions.get(writeKey) === context.revision) {
        imageModeWrites.delete(writeKey);
        confirmedImageModes.delete(writeKey);
        imageModeRevisions.delete(writeKey);
      }
    },
  });
}

/**
 * Deletes one question (and its published bank copy), then refreshes the document's questions and the
 * unit/session listings whose stored question counts change.
 */
export function useDeleteQuestion(documentId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (id: string) => questionsApi.remove(id),
    onSuccess: () => {
      success('Question deleted', 'Removed from this unit.');
      void queryClient.invalidateQueries({ queryKey: questionsQueryKey(documentId) });
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', documentId] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => { error('Could not delete', err.message); },
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
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', documentId] });
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
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', documentId] });
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
      void queryClient.invalidateQueries({ queryKey: ['latex-scan', documentId] });
    },
    onError: (err) => { error('Could not ungroup', err.message); },
  });
}
