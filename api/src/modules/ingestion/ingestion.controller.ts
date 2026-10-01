import type { RequestHandler } from 'express';
import {
  DetectStructureRequestSchema,
  StructureEstimateRequestSchema,
  SignedUploadRequestSchema,
  UploadChapterRequestSchema,
  StructureCropOcrRequestSchema,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import type { IngestionService } from './ingestion.service.js';

export function createIngestionController(service: IngestionService): {
  signedUpload: RequestHandler;
  uploadChapter: RequestHandler;
  detectStructure: RequestHandler;
  estimateStructure: RequestHandler;
  readStructureCrop: RequestHandler;
} {
  return {
    readStructureCrop: asyncHandler(async (req, res) => {
      const input = parseOrThrow(StructureCropOcrRequestSchema, req.body);
      ok(res, await service.readStructureCrop(input));
    }),
    estimateStructure: asyncHandler(async (req, res) => {
      const input = parseOrThrow(StructureEstimateRequestSchema, req.body);
      ok(res, await service.estimateStructure(input));
    }),
    detectStructure: asyncHandler(async (req, res) => {
      const input = parseOrThrow(DetectStructureRequestSchema, req.body);
      ok(res, await service.detectStructure(input));
    }),
    // Step 1: hand the browser a signed slot to upload the PDF bytes straight to storage.
    signedUpload: asyncHandler(async (req, res) => {
      const { fileName } = parseOrThrow(SignedUploadRequestSchema, req.body);
      const target = await service.createSignedUpload(fileName);
      ok(res, target);
    }),

    // Step 2: finalize — the bytes already sit in staging, so this is a small JSON body, never a file.
    uploadChapter: asyncHandler(async (req, res) => {
      const { storagePath, metadata } = parseOrThrow(UploadChapterRequestSchema, req.body);
      const result = await service.uploadChapter({ metadata, storagePath });
      ok(res, result, 201);
    }),
  };
}
