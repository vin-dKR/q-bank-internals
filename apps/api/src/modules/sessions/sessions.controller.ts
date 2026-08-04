import type { RequestHandler } from 'express';
import { CreateSessionSchema, SessionListQuerySchema, UpdateSessionSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { SessionsService } from './sessions.service.js';

/**
 * Thin HTTP adapter (§3): parses the request through a contract schema, calls the service, shapes
 * the response. No business rules, no try/catch — errors propagate to the error middleware.
 */
export function createSessionsController(service: SessionsService): {
  list: RequestHandler;
  getById: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const query = parseOrThrow(SessionListQuerySchema, req.query);
      ok(res, await service.list(query));
    }),

    getById: asyncHandler(async (req, res) => {
      ok(res, await service.getById(requiredParam(req, 'id')));
    }),

    create: asyncHandler(async (req, res) => {
      const body = parseOrThrow(CreateSessionSchema, req.body);
      ok(res, await service.create(body), 201);
    }),

    update: asyncHandler(async (req, res) => {
      const body = parseOrThrow(UpdateSessionSchema, req.body);
      ok(res, await service.update(requiredParam(req, 'id'), body));
    }),

    remove: asyncHandler(async (req, res) => {
      await service.delete(requiredParam(req, 'id'));
      ok(res, { deleted: true });
    }),
  };
}
