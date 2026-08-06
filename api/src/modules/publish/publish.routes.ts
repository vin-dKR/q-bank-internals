import { Router } from 'express';
import type { PublishService } from './publish.service.js';
import { createPublishController } from './publish.controller.js';

/**
 * Path table for publishing to the main bank:
 *   POST /documents/:documentId — publish one document's questions
 *   POST /sessions/:sessionId   — publish every extracted document in a session
 */
export function createPublishRouter(service: PublishService): Router {
  const controller = createPublishController(service);
  const router = Router();
  router.post('/documents/:documentId', controller.document);
  router.post('/sessions/:sessionId', controller.session);
  return router;
}
