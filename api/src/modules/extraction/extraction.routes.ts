import { Router } from 'express';
import type { ExtractionService } from './extraction.service.js';
import { createExtractionController } from './extraction.controller.js';

export function createExtractionRouter(service: ExtractionService): Router {
  const controller = createExtractionController(service);
  const router = Router();

  router.post('/', controller.start);
  router.post('/sessions/:sessionId', controller.startSession);
  router.get('/jobs/:id', controller.getJob);
  router.get('/documents/:documentId/job', controller.documentJob);
  router.post('/jobs/:id/cancel', controller.cancel);
  router.post('/jobs/:id/pause', controller.pause);
  router.post('/documents/:documentId/resume', controller.resume);
  router.post('/documents/:documentId/reset', controller.resetDocument);
  router.post('/documents/:documentId/reextract', controller.reextractDocument);

  return router;
}
