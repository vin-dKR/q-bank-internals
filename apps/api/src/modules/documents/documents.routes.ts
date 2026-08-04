import { Router } from 'express';
import type { DocumentsService } from './documents.service.js';
import { createDocumentsController } from './documents.controller.js';

/** Path table for the documents feature. Declares routes only — parsing + logic live downstream (§3). */
export function createDocumentsRouter(service: DocumentsService): Router {
  const controller = createDocumentsController(service);
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/', controller.register);
  router.delete('/:id', controller.remove);

  return router;
}
