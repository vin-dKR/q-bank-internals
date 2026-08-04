import type { RequestHandler } from 'express';
import { QuestionListQuerySchema, RefineLatexSchema, UpdateQuestionSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionsService } from './questions.service.js';

export function createQuestionsController(service: QuestionsService): {
  list: RequestHandler;
  update: RequestHandler;
  uploadImage: RequestHandler;
  refine: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const { documentId } = parseOrThrow(QuestionListQuerySchema, req.query);
      ok(res, await service.listByDocument(documentId));
    }),

    refine: asyncHandler(async (req, res) => {
      const { text } = parseOrThrow(RefineLatexSchema, req.body);
      ok(res, { text: await service.refineLatex(text) });
    }),

    update: asyncHandler(async (req, res) => {
      const patch = parseOrThrow(UpdateQuestionSchema, req.body);
      ok(res, await service.update(requiredParam(req, 'id'), patch));
    }),

    // Multipart: `file` = the cropped PNG blob, `name` = the storage key. Returns the public URL.
    uploadImage: asyncHandler(async (req, res) => {
      if (!req.file) throw errors.uploadMissingFile();
      const rawName = (req.body as Record<string, unknown> | undefined)?.name;
      const name = typeof rawName === 'string' ? rawName : '';
      const url = await service.uploadImage({
        name,
        bytes: req.file.buffer,
        contentType: req.file.mimetype || 'image/png',
      });
      ok(res, { url }, 201);
    }),
  };
}
