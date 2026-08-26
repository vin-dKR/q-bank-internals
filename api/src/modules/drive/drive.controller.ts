import type { RequestHandler } from 'express';
import {
  CreateFolderSchema,
  DeleteFolderParamsSchema,
  DeleteFolderQuerySchema,
  ListFoldersQuerySchema,
} from '@ingest/contracts';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { ok } from '../../shared/http/api-response.js';
import { parseOrThrow } from '../../shared/http/parse.js';
import type { DriveService } from './drive.service.js';

export function createDriveController(service: DriveService): {
  listFiles: RequestHandler;
  listFolders: RequestHandler;
  createFolder: RequestHandler;
  deleteFolder: RequestHandler;
} {
  return {
    listFiles: asyncHandler(async (_req, res) => {
      ok(res, await service.listFiles());
    }),

    listFolders: asyncHandler(async (req, res) => {
      const query = parseOrThrow(ListFoldersQuerySchema, req.query);
      ok(res, await service.listFolders(query.parentId));
    }),

    createFolder: asyncHandler(async (req, res) => {
      const body = parseOrThrow(CreateFolderSchema, req.body);
      ok(res, await service.createFolder(body), 201);
    }),

    deleteFolder: asyncHandler(async (req, res) => {
      const { id } = parseOrThrow(DeleteFolderParamsSchema, req.params);
      const { force } = parseOrThrow(DeleteFolderQuerySchema, req.query);
      ok(res, await service.deleteFolder(id, force));
    }),
  };
}
