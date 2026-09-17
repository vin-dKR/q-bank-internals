import type { DriveFile, DriveFolder } from '@ingest/contracts';
import type { DriveStorage } from './drive.storage.js';

/**
 * The Drive STORAGE destination for assembled chapter PDFs. Drive is no longer a vocabulary/browse
 * source (all metadata now comes from the all-masters dictionaries) — this only files uploads into
 * folders named after the chosen master values, and reads a PDF back for extraction. Holds the
 * configured root folder so callers never pass raw folder ids around (that decision lives in config).
 */
export class DriveService {
  constructor(
    private readonly storage: DriveStorage,
    private readonly rootFolderId: string,
  ) {}

  uploadPdf(input: { name: string; bytes: Buffer; folderId: string }): Promise<DriveFile> {
    return this.storage.uploadPdf(input);
  }

  /** Fetch a Drive PDF's bytes by id — used by the extraction worker to rasterize it. */
  downloadPdf(fileId: string): Promise<Buffer> {
    return this.storage.downloadPdf(fileId);
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
