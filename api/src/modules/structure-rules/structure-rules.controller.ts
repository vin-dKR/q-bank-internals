import type { RequestHandler } from 'express';
import { StructureRuleScopeSchema, SaveStructureRuleSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import type { StructureRulesService } from './structure-rules.service.js';

export function createStructureRulesController(service: StructureRulesService): {
  list: RequestHandler;
  resolve: RequestHandler;
  save: RequestHandler;
  remove: RequestHandler;
} {
  return {
    list: asyncHandler(async (_req, res) => {
      ok(res, await service.list());
    }),
    resolve: asyncHandler(async (req, res) => {
      ok(res, await service.resolve(parseOrThrow(StructureRuleScopeSchema, req.query)));
    }),
    save: asyncHandler(async (req, res) => {
      ok(res, await service.save(parseOrThrow(SaveStructureRuleSchema, req.body)));
    }),
    remove: asyncHandler(async (req, res) => {
      ok(res, await service.remove(parseOrThrow(StructureRuleScopeSchema, req.query)));
    }),
  };
}
