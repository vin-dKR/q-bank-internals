import { Router } from 'express';
import type { IngestionService } from './ingestion.service.js';
import { createIngestionController } from './ingestion.controller.js';

export function createIngestionRouter(service: IngestionService): Router {
  const controller = createIngestionController(service);
  const router = Router();

  // Two-step direct upload: mint a signed slot, then finalize by reference. The PDF bytes travel
  // browser → storage directly, never through this function, so a chapter is not capped by the
  // serverless request-body limit (~4.5 MB) that a multipart upload here would hit.
  router.post('/signed-upload', controller.signedUpload);
  router.post('/', controller.uploadChapter);

  return router;
}
