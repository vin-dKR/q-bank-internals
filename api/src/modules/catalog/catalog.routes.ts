import { Router } from 'express';
import type { CatalogService } from './catalog.service.js';
import { createCatalogController } from './catalog.controller.js';

/**
 * Path table for the read-only Questions browse (the published bank, filtered/searched/paginated):
 *   GET /catalog/questions?exam=&subject=&chapter=&section=&questionType=&flagged=&q=&cursor=&limit=
 *   GET /catalog/filter-options?exam=&subject=&chapter=&questionType=   — cascading dropdown values
 */
export function createCatalogRouter(service: CatalogService): Router {
  const controller = createCatalogController(service);
  const router = Router();
  router.get('/questions', controller.list);
  router.get('/filter-options', controller.filterOptions);
  return router;
}
