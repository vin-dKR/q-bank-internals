import { Router } from 'express';
import type { UsageService } from './usage.service.js';
import { createUsageController } from './usage.controller.js';

/** Path table for the usage feature. Declares routes only — parsing + logic live downstream (§3). */
export function createUsageRouter(service: UsageService): Router {
  const controller = createUsageController(service);
  const router = Router();

  router.get('/analytics', controller.analytics);
  router.get('/sessions', controller.sessions);
  router.get('/sessions/:id', controller.sessionDetail);
  router.get('/limit', controller.getLimit);
  router.put('/limit', controller.setLimit);

  return router;
}
