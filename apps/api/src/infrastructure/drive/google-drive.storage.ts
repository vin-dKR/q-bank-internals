import { Readable } from 'node:stream';
import type { drive_v3 } from 'googleapis';
import type { DriveFile, DriveFolder } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DriveStorage } from '../../modules/drive/index.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';

/** Translate a raw Drive/Gaxios failure into a clear, catalogued API error. */
function driveError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/storage quota/i.test(message)) {
    return errors.driveQuotaExceeded();
  }
  return errors.driveWriteFailed(message);
}

/**
 * Production adapter for {@link DriveStorage}, backed by the Drive API. The authenticated Drive
 * client (service-account or OAuth user) is built in the composition root and injected here.
 */
export class GoogleDriveStorage implements DriveStorage {
  constructor(private readonly drive: drive_v3.Drive) {}

  async listPdfs(folderId: string): Promise<DriveFile[]> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and mimeType='${PDF_MIME}' and trashed=false`,
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (response.data.files ?? []).map((file) => toDriveFile(file));
  }

  async listFolders(parentId: string): Promise<DriveFolder[]> {
    const response = await this.drive.files.list({
      q: `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id,name,parents)',
      orderBy: 'name',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (response.data.files ?? []).map((file) => toDriveFolder(file));
  }

  async createFolder(name: string, parentId: string): Promise<DriveFolder> {
    try {
      const response = await this.drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: 'id,name,parents',
        supportsAllDrives: true,
      });
      return toDriveFolder(response.data);
    } catch (error) {
      throw driveError(error);
    }
  }

  async uploadPdf(input: { name: string; bytes: Buffer; folderId: string }): Promise<DriveFile> {
    try {
      const response = await this.drive.files.create({
        requestBody: { name: input.name, parents: [input.folderId] },
        media: { mimeType: PDF_MIME, body: Readable.from(input.bytes) },
        fields: 'id,name,mimeType,modifiedTime,size',
        supportsAllDrives: true,
      });
      return toDriveFile(response.data);
    } catch (error) {
      throw driveError(error);
    }
  }
}

function toDriveFile(file: drive_v3.Schema$File): DriveFile {
  return {
    id: file.id ?? '',
    name: file.name ?? '',
    mimeType: file.mimeType ?? '',
    modifiedTime: file.modifiedTime ?? null,
    sizeBytes: file.size != null ? Number(file.size) : null,
  };
}

function toDriveFolder(file: drive_v3.Schema$File): DriveFolder {
  return {
    id: file.id ?? '',
    name: file.name ?? '',
    parentId: file.parents?.[0] ?? null,
  };
}
