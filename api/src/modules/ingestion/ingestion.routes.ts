import { Router, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { errors } from '../../shared/errors/error-catalog.js';
import type { IngestionService } from './ingestion.service.js';
import { createIngestionController } from './ingestion.controller.js';

/** Largest chapter PDF we accept in a single upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function createIngestionRouter(service: IngestionService): Router {
  const controller = createIngestionController(service);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });
  const router = Router();

  // The one place file-upload middleware is declared (scoped size limit, not the global JSON limit).
  // Multer's own errors are translated into the catalog so status codes never drift (§7).
  const acceptPdf: RequestHandler = (req, res, next) => {
    upload.single('pdf')(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        next(err.code === 'LIMIT_FILE_SIZE' ? errors.uploadTooLarge(MAX_UPLOAD_BYTES) : err);
        return;
      }
      next(err);
    });
  };

  router.post('/', acceptPdf, controller.uploadChapter);

  return router;
}
