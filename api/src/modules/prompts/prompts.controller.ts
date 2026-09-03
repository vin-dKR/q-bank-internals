import type { RequestHandler } from 'express';
import { PromptKeySchema, UpdatePromptSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { PromptService } from './prompts.service.js';

export function createPromptsController(service: PromptService): {
  list: RequestHandler;
  update: RequestHandler;
  reset: RequestHandler;
} {
  return {
    list: asyncHandler(async (_req, res) => {
      ok(res, await service.list());
    }),

    update: asyncHandler(async (req, res) => {
      const key = parseOrThrow(PromptKeySchema, requiredParam(req, 'key'));
      const { value } = parseOrThrow(UpdatePromptSchema, req.body);
      ok(res, await service.update(key, value));
    }),

    reset: asyncHandler(async (req, res) => {
      const key = parseOrThrow(PromptKeySchema, requiredParam(req, 'key'));
      ok(res, await service.reset(key));
    }),
  };
}
