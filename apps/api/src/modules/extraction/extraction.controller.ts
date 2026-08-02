import type { RequestHandler } from 'express';
import { StartExtractionSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { ExtractionService } from './extraction.service.js';

export function createExtractionController(service: ExtractionService): {
  start: RequestHandler;
  getJob: RequestHandler;
} {
  return {
    start: asyncHandler(async (req, res) => {
      const body = parseOrThrow(StartExtractionSchema, req.body);
      ok(res, await service.start(body.documentId), 202);
    }),

    getJob: asyncHandler(async (req, res) => {
      ok(res, await service.getJob(requiredParam(req, 'id')));
    }),
  };
}
