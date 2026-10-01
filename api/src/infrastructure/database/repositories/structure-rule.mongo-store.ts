import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  StructureRuleSchema,
  structureRuleScopeKey,
  type StructureRule,
  type StructureRuleScope,
} from '@ingest/contracts';
import type { StructureRuleStore } from '../../../modules/structure-rules/index.js';
import { errors } from '../../../shared/errors/error-catalog.js';
import { firstBatch, ejsonNumber } from '../mongo-ejson.js';

const COLLECTION = 'ingest_structure_rules';
const RawRuleSchema = StructureRuleSchema.extend({ _id: z.string() }).transform(
  ({ _id: _key, ...rule }) => rule,
);
const WriteReplySchema = z.object({
  ok: ejsonNumber,
  writeErrors: z.array(z.object({ errmsg: z.string().optional() })).optional(),
  writeConcernError: z.unknown().optional(),
});

/** Deterministic Mongo _id gives atomic upserts without changing shared-bank schemas or indexes. */
export class MongoStructureRuleStore implements StructureRuleStore {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<StructureRule[]> {
    const reply = await this.prisma.$runCommandRaw({
      find: COLLECTION,
      filter: {},
      sort: { source: 1, provider: 1 },
      limit: 1000,
      batchSize: 1000,
    });
    return firstBatch(reply).map((row) => RawRuleSchema.parse(row));
  }

  async find(scope: StructureRuleScope): Promise<StructureRule | null> {
    const reply = await this.prisma.$runCommandRaw({
      find: COLLECTION,
      filter: { _id: structureRuleScopeKey(scope) },
      limit: 1,
      batchSize: 1,
    });
    const row = firstBatch(reply)[0];
    return row === undefined ? null : RawRuleSchema.parse(row);
  }

  async save(rule: StructureRule): Promise<void> {
    const command: Prisma.InputJsonObject = {
      update: COLLECTION,
      updates: [
        {
          q: { _id: structureRuleScopeKey(rule) },
          u: {
            $set: {
              source: rule.source,
              provider: rule.provider,
              examples: rule.examples,
              expectedOutputs: rule.expectedOutputs ?? { section: null, part: null, topic: null },
              notes: rule.notes,
              updatedAt: rule.updatedAt,
            },
          },
          upsert: true,
        },
      ],
    };
    const reply = WriteReplySchema.parse(await this.prisma.$runCommandRaw(command));
    if (
      reply.ok !== 1 ||
      (reply.writeErrors?.length ?? 0) > 0 ||
      reply.writeConcernError !== undefined
    )
      throw errors.structureRuleWriteFailed();
  }
}
