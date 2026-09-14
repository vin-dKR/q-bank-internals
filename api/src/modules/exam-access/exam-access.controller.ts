import type { RequestHandler } from 'express';
import { UpdateExamAccessSchema, UserExamAccessQuerySchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { ExamAccessService } from './exam-access.service.js';

/**
 * Thin HTTP adapter (§3) for Masters → Exam access: read the catalog, list orgs/users, write one
 * entitlement. Parses through contract schemas, calls the service, shapes the response — no logic.
 */
export function createExamAccessController(service: ExamAccessService): {
  exams: RequestHandler;
  listOrganizations: RequestHandler;
  setOrganization: RequestHandler;
  listUsers: RequestHandler;
  setUser: RequestHandler;
} {
  return {
    exams: asyncHandler(async (_req, res) => {
      ok(res, await service.examOptions());
    }),

    listOrganizations: asyncHandler(async (_req, res) => {
      ok(res, await service.listOrganizations());
    }),

    setOrganization: asyncHandler(async (req, res) => {
      const body = parseOrThrow(UpdateExamAccessSchema, req.body);
      ok(res, await service.setOrganization(requiredParam(req, 'id'), body.allowedExams));
    }),

    listUsers: asyncHandler(async (req, res) => {
      const query = parseOrThrow(UserExamAccessQuerySchema, req.query);
      ok(res, await service.listUsers(query));
    }),

    setUser: asyncHandler(async (req, res) => {
      const body = parseOrThrow(UpdateExamAccessSchema, req.body);
      ok(res, await service.setUser(requiredParam(req, 'id'), body.allowedExams));
    }),
  };
}
