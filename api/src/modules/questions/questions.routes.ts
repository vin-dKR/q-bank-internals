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
 *   POST /transcribe-area     — AI-read one operator-selected source rectangle into field text
 *   PATCH /batch              — apply verify-screen edits to several questions → { updated, failed }
 *   PATCH /:id                — apply verify-screen edits (image flags/urls, stem, options, answer)
 *   DELETE /:id               — delete one question (+ its published bank copy) → { ok }
 *   POST /:id/images          — upload one cropped image (multipart) → { url }
 *   POST /paper-metadata      — AI-read a paper's header image (multipart) → { paper }
 */
export function createQuestionsRouter(service: QuestionsService): Router {
  const controller = createQuestionsController(service);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });
  const router = Router();

  router.get('/', controller.list);
  router.get('/latex-scan', controller.scanLatex);
  router.post('/latex-check-field', controller.checkLatexField);
  router.post('/latex-fix/automatic', controller.fixLatexAutomatically);
  router.post('/latex-fix/ai', controller.fixLatexWithAi);
  router.post('/refine', controller.refine);
  router.post('/transcribe-area', upload.single('file'), controller.transcribeArea);
  router.post('/paper-metadata', upload.single('file'), controller.extractPaperMetadata);
  router.post('/re-extract', controller.reExtract);
  router.post('/re-extract-group', controller.reExtractGroup);
  router.post('/:id/transcribe-region', controller.transcribeRegion);
  router.post('/group', controller.group);
  router.post('/detect-figures', controller.detectFigures);
  router.post('/detect-figures/batch', controller.detectFiguresBatch);
  // `/batch` must be declared before `/:id`, or Express would route it as id="batch".
  router.patch('/batch', controller.batchUpdate);
  // Edit / dissolve one comprehension passage (its own collection); the two-segment path never
  // collides with /:id.
  router.patch('/passages/:id', controller.updatePassage);
  router.delete('/passages/:id', controller.ungroup);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/images', upload.single('file'), controller.uploadImage);

  return router;
}
