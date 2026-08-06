import { Router } from 'express';
import type { DriveService } from './drive.service.js';
import { createDriveController } from './drive.controller.js';

export function createDriveRouter(service: DriveService): Router {
  const controller = createDriveController(service);
  const router = Router();

  router.get('/files', controller.listFiles);
  router.get('/folders', controller.listFolders);
  router.post('/folders', controller.createFolder);

  return router;
}
