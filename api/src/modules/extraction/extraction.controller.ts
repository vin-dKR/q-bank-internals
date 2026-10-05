import type { RequestHandler } from 'express';
import { StartExtractionSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import type { ExtractionService } from './extraction.service.js';

export function createExtractionController(service: ExtractionService): {
  start: RequestHandler;
  startSession: RequestHandler;
  getJob: RequestHandler;
  documentJob: RequestHandler;
  cancel: RequestHandler;
  pause: RequestHandler;
  resume: RequestHandler;
  resetDocument: RequestHandler;
  reextractDocument: RequestHandler;
} {
  return {
    start: asyncHandler(async (req, res) => {
      const body = parseOrThrow(StartExtractionSchema, req.body);
      ok(res, await service.enqueue(body.documentId), 202);
    }),

    startSession: asyncHandler(async (req, res) => {
      ok(res, await service.enqueueSession(requiredParam(req, 'sessionId')), 202);
    }),

    getJob: asyncHandler(async (req, res) => {
      ok(res, await service.getJob(requiredParam(req, 'id')));
    }),

    // The latest job for a document (or null) — the shared, cross-operator progress source.
    documentJob: asyncHandler(async (req, res) => {
      ok(res, await service.latestJobForDocument(requiredParam(req, 'documentId')));
    }),

    cancel: asyncHandler(async (req, res) => {
      ok(res, await service.cancel(requiredParam(req, 'id')));
    }),

    pause: asyncHandler(async (req, res) => {
      ok(res, await service.pause(requiredParam(req, 'id')));
    }),

    resume: asyncHandler(async (req, res) => {
      ok(res, await service.resume(requiredParam(req, 'documentId')));
    }),

    resetDocument: asyncHandler(async (req, res) => {
      ok(res, await service.resetDocument(requiredParam(req, 'documentId')));
    }),

    reextractDocument: asyncHandler(async (req, res) => {
      ok(res, await service.reextract(requiredParam(req, 'documentId')), 202);
    }),
  };
}
