import { Router } from 'express';
import type { ExamAccessService } from './exam-access.service.js';
import { createExamAccessController } from './exam-access.controller.js';

/** Path table for Masters → Exam access. Declares routes only — parsing + logic live downstream (§3). */
export function createExamAccessRouter(service: ExamAccessService): Router {
  const controller = createExamAccessController(service);
  const router = Router();

  router.get('/exams', controller.exams);
  router.get('/organizations', controller.listOrganizations);
  router.put('/organizations/:id', controller.setOrganization);
  router.get('/users', controller.listUsers);
  router.put('/users/:id', controller.setUser);

  return router;
}
