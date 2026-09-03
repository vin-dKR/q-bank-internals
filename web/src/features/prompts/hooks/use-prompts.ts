import { type UseMutationResult, type UseQueryResult, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type { PromptDefinition, PromptKey } from '@ingest/contracts';
import { useToast } from '../../../shared/ui/index.js';
import { promptsApi } from '../api/prompts.api.js';

const PROMPTS_KEY = ['prompts'];

/** Loads every editable prompt with its default + current value. */
export function usePrompts(): UseQueryResult<PromptDefinition[]> {
  return useQuery({ queryKey: PROMPTS_KEY, queryFn: () => promptsApi.list() });
}

/** Merge one updated prompt back into the cached list so the card reflects the save immediately. */
function writePrompt(queryClient: ReturnType<typeof useQueryClient>, updated: PromptDefinition): void {
  queryClient.setQueryData<PromptDefinition[]>(PROMPTS_KEY, (prev) =>
    prev?.map((prompt) => (prompt.key === updated.key ? updated : prompt)),
  );
}

/** Saves a new value for one prompt (rejected server-side if it drops a required token). */
export function useUpdatePrompt(): UseMutationResult<PromptDefinition, Error, { key: PromptKey; value: string }> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (input: { key: PromptKey; value: string }) => promptsApi.update(input.key, input.value),
    onSuccess: (updated) => {
      success('Prompt saved', `“${updated.label}” takes effect on the next run.`);
      writePrompt(queryClient, updated);
    },
    onError: (err) => { error('Could not save prompt', err.message); },
  });
}

/** Resets one prompt to its code default. */
export function useResetPrompt(): UseMutationResult<PromptDefinition, Error, PromptKey> {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: (key: PromptKey) => promptsApi.reset(key),
    onSuccess: (updated) => {
      success('Prompt reset to default', `“${updated.label}” is back to the built-in text.`);
      writePrompt(queryClient, updated);
    },
    onError: (err) => { error('Could not reset prompt', err.message); },
  });
}
