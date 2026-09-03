import { Router } from 'express';
import type { PromptService } from './prompts.service.js';
import { createPromptsController } from './prompts.controller.js';

export function createPromptsRouter(service: PromptService): Router {
  const controller = createPromptsController(service);
  const router = Router();

  router.get('/', controller.list);
  router.put('/:key', controller.update);
  router.delete('/:key', controller.reset);

  return router;
}
