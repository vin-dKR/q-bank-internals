import { Router } from 'express';
import multer from 'multer';
import type { QuestionsService } from './questions.service.js';
import { createQuestionsController } from './questions.controller.js';

/** Largest single cropped image we accept. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Path table for the questions feature:
 *   GET  /?documentId=…       — a document's extracted questions (verify/preview)
 *   POST /detect-figures      — AI-locate the figures on one page → { imageWidth, imageHeight, figures }
 *   POST /detect-figures/batch — AI-locate figures on several pages at once → { pages: [...] }
 *   PATCH /batch              — apply verify-screen edits to several questions → { updated, failed }
 *   PATCH /:id                — apply verify-screen edits (image flags/urls, stem, options, answer)
 *   POST /:id/images          — upload one cropped image (multipart) → { url }
 */
export function createQuestionsRouter(service: QuestionsService): Router {
  const controller = createQuestionsController(service);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });
  const router = Router();

  router.get('/', controller.list);
  router.post('/refine', controller.refine);
  router.post('/re-extract', controller.reExtract);
  router.post('/detect-figures', controller.detectFigures);
  router.post('/detect-figures/batch', controller.detectFiguresBatch);
  // `/batch` must be declared before `/:id`, or Express would route it as id="batch".
  router.patch('/batch', controller.batchUpdate);
  router.patch('/:id', controller.update);
  router.post('/:id/images', upload.single('file'), controller.uploadImage);

  return router;
}
