import type { RequestHandler } from 'express';
import { DocumentListQuerySchema, RegisterDocumentSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { DocumentsService } from './documents.service.js';

/**
 * Thin HTTP adapter (§3): parses the request through a contract schema, calls the service, shapes
 * the response. No business rules, no try/catch — errors propagate to the error middleware.
 */
export function createDocumentsController(service: DocumentsService): {
  list: RequestHandler;
  getById: RequestHandler;
  register: RequestHandler;
  remove: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const query = parseOrThrow(DocumentListQuerySchema, req.query);
      ok(res, await service.list(query));
    }),

    getById: asyncHandler(async (req, res) => {
      ok(res, await service.getById(requiredParam(req, 'id')));
    }),

    register: asyncHandler(async (req, res) => {
      const body = parseOrThrow(RegisterDocumentSchema, req.body);
      ok(res, await service.register(body), 201);
    }),

    remove: asyncHandler(async (req, res) => {
      await service.delete(requiredParam(req, 'id'));
      ok(res, { deleted: true });
    }),
  };
}
