import { Router } from 'express';
import type { BankService } from './bank.service.js';
import { createBankController } from './bank.controller.js';

/**
 * Path table for the published-bank fix flow:
 *   GET   /questions?q=&limit=            — search published questions in the main bank
 *   PATCH /questions/:questionId/image    — re-point one question/option image at a new cropped URL
 *
 * `:questionId` is the ingest question id stamped on the bank row's `ingest_ref`, not the Mongo `_id`.
 */
export function createBankRouter(service: BankService): Router {
  const controller = createBankController(service);
  const router = Router();
  router.get('/questions', controller.search);
  router.patch('/questions/:questionId/image', controller.updateImage);
  return router;
}
