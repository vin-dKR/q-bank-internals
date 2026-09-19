import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  AiBatchRequestSchema,
  AiFixRequestSchema,
  ApplyFixRequestSchema,
  AnomalyListQuerySchema,
  BulkFixPlanIdSchema,
  DecideProposalsSchema,
  UpdateAnomalySchema,
  type AnomalyListQuery,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { AnomalyFilters } from './quality.repository.js';
import type { QualityService } from './quality.service.js';

/** Paging for the review list; proposals are read by status, newest first. */
const ProposalListQuerySchema = z.object({
  status: z.enum(['pending', 'applied', 'rejected']).default('pending'),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  // Only pending proposals whose answer does not fit their question.
  needsDecision: z.enum(['true', 'false']).optional(),
});

/**
 * The parsed query's filter half → the repository's filter shape. Only the present keys are copied: the
 * repo runs `exactOptionalPropertyTypes`, so an optional field must be absent, never explicitly `undefined`.
 * Shared by the anomaly list and the fix queue, which filter the same set.
 */
function toFilters({ status, group, kind, severity, exam, subject, chapter, q }: Omit<AnomalyListQuery, 'cursor' | 'limit'>): AnomalyFilters {
  return {
    status,
    ...(group !== undefined && { group }),
    ...(kind !== undefined && { kind }),
    ...(severity !== undefined && { severity }),
    ...(exam !== undefined && { exam }),
    ...(subject !== undefined && { subject }),
    ...(chapter !== undefined && { chapter }),
    ...(q !== undefined && q.trim() !== '' && { q: q.trim() }),
  };
}

/** Thin HTTP adapter (§3) for the data-quality dashboard. Parses through contract schemas; no logic. */
export function createQualityController(service: QualityService): {
  summary: RequestHandler;
  listAnomalies: RequestHandler;
  filterOptions: RequestHandler;
  updateAnomaly: RequestHandler;
  fixQueue: RequestHandler;
  fixTarget: RequestHandler;
  applyFix: RequestHandler;
  aiFix: RequestHandler;
  aiBatch: RequestHandler;
  listProposals: RequestHandler;
  decideProposals: RequestHandler;
  retryProposal: RequestHandler;
  bulkFixes: RequestHandler;
  applyBulkFix: RequestHandler;
  runScan: RequestHandler;
  listScans: RequestHandler;
  aiFilledSummary: RequestHandler;
} {
  return {
    summary: asyncHandler(async (_req, res) => {
      ok(res, await service.summary());
    }),

    listAnomalies: asyncHandler(async (req, res) => {
      const { cursor, limit, ...rest } = parseOrThrow(AnomalyListQuerySchema, req.query);
      ok(res, await service.listAnomalies(toFilters(rest), cursor ?? null, limit));
    }),

    updateAnomaly: asyncHandler(async (req, res) => {
      const body = parseOrThrow(UpdateAnomalySchema, req.body);
      ok(res, await service.updateAnomaly(requiredParam(req, 'id'), body));
    }),

    filterOptions: asyncHandler(async (req, res) => {
      // The same query shape as the list, so one selection drives both; paging is meaningless here.
      const query = parseOrThrow(AnomalyListQuerySchema, req.query);
      ok(res, await service.listFilterOptions(toFilters(query)));
    }),

    fixQueue: asyncHandler(async (req, res) => {
      const { cursor, limit, ...rest } = parseOrThrow(AnomalyListQuerySchema, req.query);
      ok(res, await service.listFixQueue(toFilters(rest), cursor ?? null, limit));
    }),

    fixTarget: asyncHandler(async (req, res) => {
      ok(res, await service.fixTarget(requiredParam(req, 'questionId')));
    }),

    applyFix: asyncHandler(async (req, res) => {
      const { fix, ai } = parseOrThrow(ApplyFixRequestSchema, req.body);
      ok(res, await service.applyFix(requiredParam(req, 'questionId'), fix, ai ? { claim: ai, via: 'assist' } : null));
    }),

    aiFix: asyncHandler(async (req, res) => {
      const { fields, respectType } = parseOrThrow(AiFixRequestSchema, req.body);
      ok(res, await service.aiFix(requiredParam(req, 'questionId'), fields, respectType));
    }),

    aiBatch: asyncHandler(async (req, res) => {
      const request = parseOrThrow(AiBatchRequestSchema, req.body);
      ok(res, await service.runAiBatch(request, toFilters(request.filters)));
    }),

    listProposals: asyncHandler(async (req, res) => {
      const { status, cursor, limit, needsDecision } = parseOrThrow(ProposalListQuerySchema, req.query);
      ok(res, await service.listProposals(status, cursor ?? null, limit, needsDecision === 'true'));
    }),

    decideProposals: asyncHandler(async (req, res) => {
      const decision = parseOrThrow(DecideProposalsSchema, req.body);
      ok(res, await service.decideProposals(decision));
    }),

    retryProposal: asyncHandler(async (req, res) => {
      ok(res, await service.retryProposal(requiredParam(req, 'id')));
    }),

    bulkFixes: asyncHandler(async (_req, res) => {
      ok(res, await service.bulkFixPreview());
    }),

    applyBulkFix: asyncHandler(async (req, res) => {
      const plan = parseOrThrow(BulkFixPlanIdSchema, requiredParam(req, 'plan'));
      ok(res, await service.applyBulkFix(plan));
    }),

    runScan: asyncHandler(async (_req, res) => {
      ok(res, await service.runScan(), 201);
    }),

    listScans: asyncHandler(async (_req, res) => {
      ok(res, await service.listScans());
    }),

    aiFilledSummary: asyncHandler(async (_req, res) => {
      ok(res, await service.aiFilledSummary());
    }),
  };
}
