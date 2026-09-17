import { Router } from 'express';
import type { MastersService } from './masters.service.js';
import { createMastersController } from './masters.controller.js';

/**
 * Path table for Masters → Question taxonomy. Every route is scoped by a `:dimension` segment (exam /
 * subject / chapter / section / questionType / level / topic); the controller validates it. Declares
 * routes only — parsing + logic live downstream (§3).
 */
export function createMastersRouter(service: MastersService): Router {
  const controller = createMastersController(service);
  const router = Router();

  router.get('/:dimension', controller.list);
  router.post('/:dimension', controller.create);
  router.post('/:dimension/seed', controller.seed);
  router.put('/:dimension/:id', controller.update);
  router.delete('/:dimension/:id', controller.remove);

  return router;
}
