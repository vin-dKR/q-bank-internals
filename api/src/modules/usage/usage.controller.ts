import type { RequestHandler } from 'express';
import { UpdateTokenLimitSchema, UsageAnalyticsQuerySchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { UsageService } from './usage.service.js';

/**
 * Thin HTTP adapter (§3) for the Usage dashboard: analytics read, budget read, budget write. Parses
 * through contract schemas, calls the service, shapes the response — no logic, no try/catch.
 */
export function createUsageController(service: UsageService): {
  analytics: RequestHandler;
  sessions: RequestHandler;
  sessionDetail: RequestHandler;
  getLimit: RequestHandler;
  setLimit: RequestHandler;
} {
  return {
    analytics: asyncHandler(async (req, res) => {
      const query = parseOrThrow(UsageAnalyticsQuerySchema, req.query);
      ok(res, await service.getAnalytics(query));
    }),

    sessions: asyncHandler(async (_req, res) => {
      ok(res, await service.getSessionUsage());
    }),

    sessionDetail: asyncHandler(async (req, res) => {
      ok(res, await service.getSessionUsageDetail(requiredParam(req, 'id')));
    }),

    getLimit: asyncHandler(async (_req, res) => {
      ok(res, await service.getLimit());
    }),

    setLimit: asyncHandler(async (req, res) => {
      const body = parseOrThrow(UpdateTokenLimitSchema, req.body);
      ok(res, await service.setLimit(body));
    }),
  };
}
