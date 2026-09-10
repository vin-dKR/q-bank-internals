import type { RequestHandler } from 'express';
import { BankSearchQuerySchema, UpdateBankFlagSchema, UpdateBankImageSchema, UpdateBankPassageSchema, UpdateBankTextSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { BankService } from './bank.service.js';

export function createBankController(service: BankService): {
  search: RequestHandler;
  updateImage: RequestHandler;
  setFlag: RequestHandler;
  setText: RequestHandler;
  remove: RequestHandler;
  setPassage: RequestHandler;
} {
  return {
    search: asyncHandler(async (req, res) => {
      const { q, limit } = parseOrThrow(BankSearchQuerySchema, req.query);
      ok(res, await service.search(q, limit));
    }),

    updateImage: asyncHandler(async (req, res) => {
      const patch = parseOrThrow(UpdateBankImageSchema, req.body);
      ok(res, await service.updateImage(requiredParam(req, 'questionId'), patch));
    }),

    setFlag: asyncHandler(async (req, res) => {
      const { flagged } = parseOrThrow(UpdateBankFlagSchema, req.body);
      ok(res, await service.setFlag(requiredParam(req, 'id'), flagged));
    }),

    setText: asyncHandler(async (req, res) => {
      const patch = parseOrThrow(UpdateBankTextSchema, req.body);
      ok(res, await service.setText(requiredParam(req, 'id'), patch));
    }),

    remove: asyncHandler(async (req, res) => {
      ok(res, await service.deleteQuestion(requiredParam(req, 'id')));
    }),

    setPassage: asyncHandler(async (req, res) => {
      const { passage } = parseOrThrow(UpdateBankPassageSchema, req.body);
      ok(res, await service.setPassage(requiredParam(req, 'groupId'), passage));
    }),
  };
}
