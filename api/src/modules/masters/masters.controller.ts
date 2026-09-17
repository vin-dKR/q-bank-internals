import type { RequestHandler } from 'express';
import {
  CreateDictionaryEntrySchema,
  DictionaryQuerySchema,
  TaxonomyDimensionSchema,
  UpdateDictionaryEntrySchema,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { MastersService } from './masters.service.js';

/**
 * Thin HTTP adapter (§3) for Masters → Question taxonomy. The `:dimension` path segment is validated
 * through the contract enum before it reaches the service, so an unknown dimension 400s cleanly.
 */
export function createMastersController(service: MastersService): {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  seed: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const dimension = parseOrThrow(TaxonomyDimensionSchema, req.params.dimension);
      const query = parseOrThrow(DictionaryQuerySchema, req.query);
      ok(res, await service.list(dimension, query));
    }),

    create: asyncHandler(async (req, res) => {
      const dimension = parseOrThrow(TaxonomyDimensionSchema, req.params.dimension);
      const body = parseOrThrow(CreateDictionaryEntrySchema, req.body);
      ok(res, await service.create(dimension, body), 201);
    }),

    update: asyncHandler(async (req, res) => {
      const dimension = parseOrThrow(TaxonomyDimensionSchema, req.params.dimension);
      const body = parseOrThrow(UpdateDictionaryEntrySchema, req.body);
      ok(res, await service.update(dimension, requiredParam(req, 'id'), body));
    }),

    remove: asyncHandler(async (req, res) => {
      const dimension = parseOrThrow(TaxonomyDimensionSchema, req.params.dimension);
      await service.remove(dimension, requiredParam(req, 'id'));
      ok(res, { ok: true });
    }),

    seed: asyncHandler(async (req, res) => {
      const dimension = parseOrThrow(TaxonomyDimensionSchema, req.params.dimension);
      ok(res, await service.seed(dimension));
    }),
  };
}
