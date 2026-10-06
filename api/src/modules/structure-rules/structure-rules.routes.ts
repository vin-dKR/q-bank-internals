import { Router } from 'express';
import { createStructureRulesController } from './structure-rules.controller.js';
import type { StructureRulesService } from './structure-rules.service.js';

export function createStructureRulesRouter(service: StructureRulesService): Router {
  const router = Router();
  const controller = createStructureRulesController(service);
  router.get('/', controller.list);
  router.get('/resolve', controller.resolve);
  router.put('/', controller.save);
  router.delete('/', controller.remove);
  return router;
}
