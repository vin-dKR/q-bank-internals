import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { requiredParam } from '../../shared/http/params.js';
import type { PublishService } from './publish.service.js';

export function createPublishController(service: PublishService): {
  document: RequestHandler;
  documentIssues: RequestHandler;
  session: RequestHandler;
} {
  return {
    document: asyncHandler(async (req, res) => {
      ok(res, await service.publishDocument(requiredParam(req, 'documentId')), 201);
    }),

    documentIssues: asyncHandler(async (req, res) => {
      ok(res, await service.listPublishIssues(requiredParam(req, 'documentId')));
    }),

    session: asyncHandler(async (req, res) => {
      ok(res, await service.publishSession(requiredParam(req, 'sessionId')), 201);
    }),
  };
}
