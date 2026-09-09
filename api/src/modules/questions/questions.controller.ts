import type { RequestHandler } from 'express';
import {
  BatchUpdateQuestionsSchema,
  DetectFiguresBatchRequestSchema,
  DetectFiguresRequestSchema,
  GroupQuestionsSchema,
  QuestionListQuerySchema,
  ReExtractGroupSchema,
  ReExtractQuestionSchema,
  RefineLatexSchema,
  UpdatePassageSchema,
  UpdateQuestionSchema,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionsService } from './questions.service.js';

export function createQuestionsController(service: QuestionsService): {
  list: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  updatePassage: RequestHandler;
  group: RequestHandler;
  ungroup: RequestHandler;
  batchUpdate: RequestHandler;
  uploadImage: RequestHandler;
  refine: RequestHandler;
  reExtract: RequestHandler;
  reExtractGroup: RequestHandler;
  detectFigures: RequestHandler;
  detectFiguresBatch: RequestHandler;
  extractPaperMetadata: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const { documentId } = parseOrThrow(QuestionListQuerySchema, req.query);
      ok(res, await service.listByDocument(documentId));
    }),

    detectFigures: asyncHandler(async (req, res) => {
      const { documentId, page } = parseOrThrow(DetectFiguresRequestSchema, req.body);
      ok(res, await service.detectFigures(documentId, page));
    }),

    detectFiguresBatch: asyncHandler(async (req, res) => {
      const { documentId, pages } = parseOrThrow(DetectFiguresBatchRequestSchema, req.body);
      ok(res, await service.detectFiguresBatch(documentId, pages));
    }),

    refine: asyncHandler(async (req, res) => {
      const { text } = parseOrThrow(RefineLatexSchema, req.body);
      ok(res, { text: await service.refineLatex(text) });
    }),

    reExtract: asyncHandler(async (req, res) => {
      const { documentId, questionId, source, questionType } = parseOrThrow(ReExtractQuestionSchema, req.body);
      ok(res, await service.reExtractQuestion(documentId, questionId, source, questionType));
    }),

    reExtractGroup: asyncHandler(async (req, res) => {
      const { documentId, passageId, source, questionType } = parseOrThrow(ReExtractGroupSchema, req.body);
      ok(res, await service.reExtractGroup(documentId, passageId, source, questionType));
    }),

    update: asyncHandler(async (req, res) => {
      const patch = parseOrThrow(UpdateQuestionSchema, req.body);
      ok(res, await service.update(requiredParam(req, 'id'), patch));
    }),

    remove: asyncHandler(async (req, res) => {
      await service.delete(requiredParam(req, 'id'));
      ok(res, { ok: true });
    }),

    updatePassage: asyncHandler(async (req, res) => {
      const patch = parseOrThrow(UpdatePassageSchema, req.body);
      ok(res, await service.updatePassage(requiredParam(req, 'id'), patch));
    }),

    group: asyncHandler(async (req, res) => {
      const { documentId, questionIds } = parseOrThrow(GroupQuestionsSchema, req.body);
      ok(res, await service.groupQuestions(documentId, questionIds), 201);
    }),

    ungroup: asyncHandler(async (req, res) => {
      await service.ungroupPassage(requiredParam(req, 'id'));
      ok(res, { ok: true });
    }),

    batchUpdate: asyncHandler(async (req, res) => {
      const { updates } = parseOrThrow(BatchUpdateQuestionsSchema, req.body);
      ok(res, await service.batchUpdate(updates));
    }),

    // Multipart: `file` = the rendered header-page PNG. Returns the AI-read paper fields.
    extractPaperMetadata: asyncHandler(async (req, res) => {
      if (!req.file) throw errors.uploadMissingFile();
      ok(res, { paper: await service.extractPaperMetadata(req.file.buffer) });
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
