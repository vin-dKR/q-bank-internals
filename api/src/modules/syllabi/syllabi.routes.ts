import { Router } from 'express';
import { createSyllabiController } from './syllabi.controller.js';
import type { SyllabiService } from './syllabi.service.js';

export function createSyllabiRouter(service: SyllabiService): Router {
  const controller = createSyllabiController(service);
  const router = Router();

  router.get('/', controller.list);
  // Before `/:exam`, or "formats" would read as an exam name.
  router.get('/formats', controller.formats);
  router.get('/:exam', controller.detail);
  router.post('/', controller.upload);
  router.delete('/:exam', controller.remove);

  return router;
}
