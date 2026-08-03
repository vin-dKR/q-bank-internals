import { Router } from 'express';
import type { SessionsService } from './sessions.service.js';
import { createSessionsController } from './sessions.controller.js';

/** Path table for the sessions feature. Declares routes only — parsing + logic live downstream (§3). */
export function createSessionsRouter(service: SessionsService): Router {
  const controller = createSessionsController(service);
  const router = Router();

  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);

  return router;
}
