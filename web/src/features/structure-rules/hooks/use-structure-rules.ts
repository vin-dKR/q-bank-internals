import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  structureRuleScope,
  structureRuleScopeKey,
  type StructureRule,
  type SaveStructureRule,
  type StructureDetectionContext,
} from '@ingest/contracts';
import { structureRulesApi } from '../api/structure-rules.api.js';
import { useToast } from '../../../shared/ui/index.js';

const RULES_KEY = ['structure-rules'];

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
