import {
  structureRuleScopeKey,
  type StructureRule,
  type StructureRuleScope,
} from '@ingest/contracts';
import type { StructureRuleStore } from '../../../modules/structure-rules/index.js';

export class InMemoryStructureRuleStore implements StructureRuleStore {
  private readonly rows = new Map<string, StructureRule>();
  list(): Promise<StructureRule[]> {
    return Promise.resolve(
      structuredClone([...this.rows.values()].sort((a, b) => a.provider.localeCompare(b.provider))),
    );
  }
  find(scope: StructureRuleScope): Promise<StructureRule | null> {
    const value = this.rows.get(structureRuleScopeKey(scope));
    return Promise.resolve(value ? structuredClone(value) : null);
  }
  save(rule: StructureRule): Promise<void> {
    this.rows.set(structureRuleScopeKey(rule), structuredClone(rule));
    return Promise.resolve();
  }
  remove(scope: StructureRuleScope): Promise<void> {
    this.rows.delete(structureRuleScopeKey(scope));
    return Promise.resolve();
  }
}
