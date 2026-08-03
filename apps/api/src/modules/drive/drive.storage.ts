import type { DriveFile, DriveFolder } from '@ingest/contracts';

/**
 * The Drive PORT (§3). The service depends on this interface; the concrete `googleapis`-backed
 * adapter lives in `infrastructure/drive/` and is wired in the composition root (§5).
 */
export interface DriveStorage {
  /** List the PDFs directly inside the given folder, newest first. */
  listPdfs(folderId: string): Promise<DriveFile[]>;

  /** List the sub-folders directly inside the given folder. */
  listFolders(parentId: string): Promise<DriveFolder[]>;

  /** Create a folder with the given name under the given parent. */
  createFolder(name: string, parentId: string): Promise<DriveFolder>;

  /** Upload PDF bytes as a new file inside the given folder. */
  uploadPdf(input: { name: string; bytes: Buffer; folderId: string }): Promise<DriveFile>;

  /** Download a file's raw bytes by id — how the extraction worker fetches a Drive PDF. */
  downloadPdf(fileId: string): Promise<Buffer>;
}
