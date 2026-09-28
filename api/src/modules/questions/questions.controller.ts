import type { RequestHandler } from 'express';
import {
  BatchUpdateQuestionsSchema,
  DetectFiguresBatchRequestSchema,
  DetectFiguresRequestSchema,
  GroupQuestionsSchema,
  LatexAiBatchRequestSchema,
  LatexFieldCheckRequestSchema,
  LatexFixRequestSchema,
  QuestionListQuerySchema,
  ReExtractGroupSchema,
  ReExtractQuestionSchema,
  RefineLatexSchema,
  TranscribeAreaRequestSchema,
  UpdatePassageSchema,
  UpdateQuestionSchema,
  TranscribeQuestionRegionRequestSchema,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { requiredParam } from '../../shared/http/params.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { QuestionsService } from './questions.service.js';

export function createQuestionsController(service: QuestionsService): {
  list: RequestHandler;
  scanLatex: RequestHandler;
  checkLatexField: RequestHandler;
  fixLatexAutomatically: RequestHandler;
  fixLatexWithAi: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  updatePassage: RequestHandler;
  group: RequestHandler;
  ungroup: RequestHandler;
  batchUpdate: RequestHandler;
  uploadImage: RequestHandler;
  refine: RequestHandler;
  transcribeArea: RequestHandler;
  reExtract: RequestHandler;
  reExtractGroup: RequestHandler;
  detectFigures: RequestHandler;
  detectFiguresBatch: RequestHandler;
  extractPaperMetadata: RequestHandler;
  transcribeRegion: RequestHandler;
} {
  return {
    list: asyncHandler(async (req, res) => {
      const { documentId } = parseOrThrow(QuestionListQuerySchema, req.query);
      ok(res, await service.listByDocument(documentId));
    }),

    scanLatex: asyncHandler(async (req, res) => {
      const { documentId } = parseOrThrow(QuestionListQuerySchema, req.query);
      ok(res, await service.scanLatex(documentId));
    }),
    checkLatexField: asyncHandler((req, res) => {
      const { field, text } = parseOrThrow(LatexFieldCheckRequestSchema, req.body);
      return Promise.resolve(ok(res, service.checkLatexField(field, text)));
    }),
    fixLatexAutomatically: asyncHandler(async (req, res) => {
      const { documentId } = parseOrThrow(LatexFixRequestSchema, req.body);
      ok(res, await service.fixLatexAutomatically(documentId));
    }),
    fixLatexWithAi: asyncHandler(async (req, res) => {
      const { documentId, keys } = parseOrThrow(LatexAiBatchRequestSchema, req.body);
      ok(res, await service.fixLatexWithAi(documentId, keys));
    }),

    detectFigures: asyncHandler(async (req, res) => {
      const { documentId, page, source } = parseOrThrow(DetectFiguresRequestSchema, req.body);
      ok(res, await service.detectFigures(documentId, page, source));
    }),

    detectFiguresBatch: asyncHandler(async (req, res) => {
      const { documentId, pages, source } = parseOrThrow(DetectFiguresBatchRequestSchema, req.body);
      ok(res, await service.detectFiguresBatch(documentId, pages, source));
    }),

    refine: asyncHandler(async (req, res) => {
      const { text } = parseOrThrow(RefineLatexSchema, req.body);
      ok(res, { text: await service.refineLatex(text) });
    }),

    transcribeArea: asyncHandler(async (req, res) => {
      if (!req.file) throw errors.uploadMissingFile();
      const { documentId, target } = parseOrThrow(TranscribeAreaRequestSchema, req.body);
      ok(res, { text: await service.transcribeSourceArea(documentId, req.file.buffer, target) });
    }),

    reExtract: asyncHandler(async (req, res) => {
      const { documentId, questionId, source, questionType } = parseOrThrow(
        ReExtractQuestionSchema,
        req.body,
      );
      ok(res, await service.reExtractQuestion(documentId, questionId, source, questionType));
    }),

    reExtractGroup: asyncHandler(async (req, res) => {
      const { documentId, passageId, source, questionType, mode } = parseOrThrow(
        ReExtractGroupSchema,
        req.body,
      );
      ok(res, await service.reExtractGroup(documentId, passageId, source, questionType, mode));
    }),

    transcribeRegion: asyncHandler(async (req, res) => {
      const input = parseOrThrow(TranscribeQuestionRegionRequestSchema, req.body);
      ok(res, await service.transcribeQuestionRegion({ questionId: requiredParam(req, 'id'), ...input }));
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
