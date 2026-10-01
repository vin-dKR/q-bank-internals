import {
  StructureRuleListSchema,
  StructureRuleSchema,
  ResolvedStructureRuleSchema,
  type StructureRule,
  type StructureRuleScope,
  type SaveStructureRule,
} from '@ingest/contracts';
import { request } from '../../../shared/api/http-client.js';

export const structureRulesApi = {
  list: (): Promise<StructureRule[]> =>
    request('/structure-rules', { schema: StructureRuleListSchema }),
  resolve: (scope: StructureRuleScope): Promise<StructureRule | null> => {
    const query = new URLSearchParams(scope).toString();
    return request(`/structure-rules/resolve?${query}`, { schema: ResolvedStructureRuleSchema });
  },
  save: (rule: SaveStructureRule): Promise<StructureRule> =>
    request('/structure-rules', { method: 'PUT', body: rule, schema: StructureRuleSchema }),
};
