import type { RequestHandler } from 'express';
import { SyllabusUploadSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { SyllabiService } from './syllabi.service.js';

export function createSyllabiController(service: SyllabiService): {
  list: RequestHandler;
  formats: RequestHandler;
  detail: RequestHandler;
  upload: RequestHandler;
  remove: RequestHandler;
} {
  return {
    list: asyncHandler(async (_req, res) => {
      ok(res, await service.list());
    }),

    formats: (_req, res) => {
      ok(res, service.formats());
    },

    detail: asyncHandler(async (req, res) => {
      ok(res, await service.detail(requiredParam(req, 'exam')));
    }),

    upload: asyncHandler(async (req, res) => {
      ok(res, await service.upload(parseOrThrow(SyllabusUploadSchema, req.body)));
    }),

    remove: asyncHandler(async (req, res) => {
      ok(res, await service.remove(requiredParam(req, 'exam')));
    }),
  };
}
