import { Router } from 'express';
import { createDocumentsRouter } from './modules/documents/index.js';
import { createExtractionRouter } from './modules/extraction/index.js';
import { createDriveRouter } from './modules/drive/index.js';
import { createIngestionRouter } from './modules/ingestion/index.js';
import type { Container } from './container.js';

/** Mounts every feature router under its base path. The one place the URL map is declared. */
export function createApiRouter(container: Container): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  router.use('/documents', createDocumentsRouter(container.documentsService));
  router.use('/extraction', createExtractionRouter(container.extractionService));
  router.use('/drive', createDriveRouter(container.driveService));
  router.use('/ingestion', createIngestionRouter(container.ingestionService));

  return router;
}
