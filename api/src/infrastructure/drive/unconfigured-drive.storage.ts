import type { DriveFile, DriveFolder } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DriveStorage } from '../../modules/drive/index.js';

/**
 * Null-object adapter used when Drive credentials are absent, so the app still boots (dev/memory).
 * Any actual Drive call fails loudly with a clear error instead of a confusing crash.
 */
export class UnconfiguredDriveStorage implements DriveStorage {
  listPdfs(_folderId: string): Promise<DriveFile[]> {
    return Promise.reject(errors.driveUnavailable());
  }

  listFolders(_parentId: string): Promise<DriveFolder[]> {
    return Promise.reject(errors.driveUnavailable());
  }

  createFolder(_name: string, _parentId: string): Promise<DriveFolder> {
    return Promise.reject(errors.driveUnavailable());
  }

  uploadPdf(_input: { name: string; bytes: Buffer; folderId: string }): Promise<DriveFile> {
    return Promise.reject(errors.driveUnavailable());
  }

  downloadPdf(_fileId: string): Promise<Buffer> {
    return Promise.reject(errors.driveUnavailable());
  }
}
