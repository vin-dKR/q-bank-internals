import { Router } from 'express';
import type { BankService } from './bank.service.js';
import { createBankController } from './bank.controller.js';

/**
 * Path table for the published-bank fix flow:
 *   GET   /questions?q=&limit=            — search published questions in the main bank
 *   PATCH  /questions/:questionId/image   — re-point one question/option image at a new cropped URL
 *   PATCH  /questions/:id/flag            — set/clear the flag on a published question
 *   PATCH  /questions/:id/text            — overwrite the stem/options/answer/explanation/match content
 *   DELETE /questions/:id                 — permanently remove a published question from the bank
 *   PATCH  /groups/:groupId/passage       — rewrite a comprehension group's shared passage (all rows)
 *
 * `:questionId` (image) is the ingest question id stamped on the bank row's `ingest_ref`. `:id` (flag,
 * text, delete) is the bank Mongo `_id` the browse card carries, so all work even for rows with no
 * `ingest_ref`. `:groupId` (passage) is the denormalized `group_id` every comprehension sibling row carries.
 */
export function createBankRouter(service: BankService): Router {
  const controller = createBankController(service);
  const router = Router();
  router.get('/questions', controller.search);
  router.patch('/questions/:questionId/image', controller.updateImage);
  router.patch('/questions/:id/flag', controller.setFlag);
  router.patch('/questions/:id/text', controller.setText);
  router.delete('/questions/:id', controller.remove);
  router.patch('/groups/:groupId/passage', controller.setPassage);
  return router;
}
