import { Router } from 'express';
import type { ExtractionService } from './extraction.service.js';
import { createExtractionController } from './extraction.controller.js';

export function createExtractionRouter(service: ExtractionService): Router {
  const controller = createExtractionController(service);
  const router = Router();

  router.post('/', controller.start);
  router.get('/jobs/:id', controller.getJob);

  return router;
}
