import { Router } from 'express';
import type { PagesService } from './pages.service.js';
import { createPagesController } from './pages.controller.js';

/**
 * Path table for the pages feature:
 *   GET /:documentId/count   — how many pages the document's PDF has
 *   GET /:documentId/:page   — that page rendered as a PNG (the crop canvas)
 */
export function createPagesRouter(service: PagesService): Router {
  const controller = createPagesController(service);
  const router = Router();
  router.get('/:documentId/count', controller.count);
  router.get('/:documentId/:page', controller.render);
  return router;
}
