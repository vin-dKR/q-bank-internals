import type { StructureRule, StructureRuleScope } from '@ingest/contracts';

export interface StructureRuleStore {
  list(): Promise<StructureRule[]>;
  find(scope: StructureRuleScope): Promise<StructureRule | null>;
  save(rule: StructureRule): Promise<void>;
  remove(scope: StructureRuleScope): Promise<void>;
}
