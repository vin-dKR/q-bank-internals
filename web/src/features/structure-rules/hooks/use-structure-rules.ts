import {
  useQuery,
  useMutation,
  useQueryClient,
  useIsMutating,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  structureRuleScope,
  structureRuleScopeKey,
  type StructureRule,
  type SaveStructureRule,
  type StructureDetectionContext,
  type StructureRuleScope,
  type DeleteStructureRuleResult,
} from '@ingest/contracts';
import { structureRulesApi } from '../api/structure-rules.api.js';
import { useToast } from '../../../shared/ui/index.js';

const RULES_KEY = ['structure-rules'];

export function useStructureRulesWriting(): boolean {
  return useIsMutating({ mutationKey: RULES_KEY }) > 0;
}

export function useStructureRules(): UseQueryResult<StructureRule[]> {
  return useQuery({ queryKey: RULES_KEY, queryFn: () => structureRulesApi.list() });
}

export function useResolvedStructureRule(
  context: StructureDetectionContext,
): UseQueryResult<StructureRule | null> {
  const scope = structureRuleScope(context);
  return useQuery({
    queryKey: [...RULES_KEY, 'resolve', scope ? structureRuleScopeKey(scope) : null],
    enabled: scope !== null,
    queryFn: () => (scope ? structureRulesApi.resolve(scope) : Promise.resolve(null)),
    staleTime: 30000,
  });
}

export function useSaveStructureRule(): UseMutationResult<StructureRule, Error, SaveStructureRule> {
  const client = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationKey: [...RULES_KEY, 'save'],
    mutationFn: (rule: SaveStructureRule) => structureRulesApi.save(rule),
    onSuccess: (rule) => {
      client.setQueryData<StructureRule[]>(RULES_KEY, (previous) => {
        const entries = (previous ?? []).filter(
          (value) => structureRuleScopeKey(value) !== structureRuleScopeKey(rule),
        );
        return [...entries, rule].sort((a, b) => a.provider.localeCompare(b.provider));
      });
      void client.invalidateQueries({ queryKey: [...RULES_KEY, 'resolve'] });
      success('Structure rules saved', `${rule.provider}: applied to the next detection.`);
    },
    onError: (err) => {
      error('Could not save structure rules', err.message);
    },
  });
}

export function useDeleteStructureRule(): UseMutationResult<
  DeleteStructureRuleResult,
  Error,
  StructureRuleScope
> {
  const client = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationKey: [...RULES_KEY, 'delete'],
    mutationFn: (scope: StructureRuleScope) => structureRulesApi.remove(scope),
    onSuccess: (_result, scope) => {
      const key = structureRuleScopeKey(scope);
      client.setQueryData<StructureRule[]>(RULES_KEY, (previous) =>
        (previous ?? []).filter((rule) => structureRuleScopeKey(rule) !== key),
      );
      client.setQueryData([...RULES_KEY, 'resolve', key], null);
      void client.invalidateQueries({ queryKey: [...RULES_KEY, 'resolve', key] });
      success('Rule set deleted', `${scope.provider}: new detections use the default hierarchy.`);
    },
    onError: (err) => {
      error('Could not delete rule set', err.message);
    },
  });
}
