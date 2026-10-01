import {
  SaveStructureRuleSchema,
  structureRuleScope,
  type SaveStructureRule,
  type StructureRule,
  type StructureRuleScope,
  type StructureDetectionContext,
} from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { StructureRuleStore } from './structure-rules.repository.js';

export interface StructureRuleResolver {
  resolveContext(context: StructureDetectionContext): Promise<StructureRule | null>;
}

/** Operator examples are isolated by source + provider and loaded once per detection. */
export class StructureRulesService implements StructureRuleResolver {
  constructor(private readonly store: StructureRuleStore) {}

  list(): Promise<StructureRule[]> {
    return this.store.list();
  }
  resolve(scope: StructureRuleScope): Promise<StructureRule | null> {
    return this.store.find(scope);
  }

  resolveContext(context: StructureDetectionContext): Promise<StructureRule | null> {
    const scope = structureRuleScope(context);
    return scope ? this.store.find(scope) : Promise.resolve(null);
  }

  async save(input: SaveStructureRule): Promise<StructureRule> {
    const parsed = SaveStructureRuleSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.flatten());
    const rule = { ...parsed.data, updatedAt: new Date().toISOString() };
    await this.store.save(rule);
    return rule;
  }
}
