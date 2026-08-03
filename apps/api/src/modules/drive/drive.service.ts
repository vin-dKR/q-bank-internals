import type { CreateFolder, DriveFile, DriveFolder } from '@ingest/contracts';
import type { DriveStorage } from './drive.storage.js';

/**
 * Business rules for browsing Drive. Holds the configured root folder so callers never pass raw
 * folder ids around — the "which folder is the ingest folder" decision lives in one place (config).
 */
export class DriveService {
  constructor(
    private readonly storage: DriveStorage,
    private readonly rootFolderId: string,
  ) {}

  listFiles(): Promise<DriveFile[]> {
    return this.storage.listPdfs(this.rootFolderId);
  }

  /** Folders directly under `parentId`, defaulting to the configured root when omitted. */
  listFolders(parentId?: string): Promise<DriveFolder[]> {
    return this.storage.listFolders(parentId ?? this.rootFolderId);
  }

  /** Create a folder under `parentId`, defaulting to the configured root when omitted. */
  createFolder(input: CreateFolder): Promise<DriveFolder> {
    return this.storage.createFolder(input.name, input.parentId ?? this.rootFolderId);
  }

  uploadPdf(input: { name: string; bytes: Buffer; folderId: string }): Promise<DriveFile> {
    return this.storage.uploadPdf(input);
  }

  /**
   * Return the folder named `name` under `parentId`, creating it if it does not exist. The
   * idempotent building block the ingestion service chains to ensure a nested chapter path.
   */
  async findOrCreateFolder(name: string, parentId?: string): Promise<DriveFolder> {
    const parent = parentId ?? this.rootFolderId;
    const existing = await this.storage.listFolders(parent);
    const match = existing.find((folder) => folder.name === name);
    if (match) {
      return match;
    }
    return this.storage.createFolder(name, parent);
  }
}
