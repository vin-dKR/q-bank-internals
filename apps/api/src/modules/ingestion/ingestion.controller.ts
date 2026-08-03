import type { RequestHandler } from 'express';
import { ChapterUploadMetadataSchema } from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { IngestionService } from './ingestion.service.js';

export function createIngestionController(service: IngestionService): {
  uploadChapter: RequestHandler;
} {
  return {
    uploadChapter: asyncHandler(async (req, res) => {
      if (!req.file) {
        throw errors.uploadMissingFile();
      }
      const body = req.body as { metadata?: unknown };
      const raw: unknown = typeof body.metadata === 'string' ? JSON.parse(body.metadata) : body.metadata;
      const metadata = parseOrThrow(ChapterUploadMetadataSchema, raw);
      const driveFile = await service.uploadChapter({ metadata, bytes: req.file.buffer });
      ok(res, driveFile, 201);
    }),
  };
}
