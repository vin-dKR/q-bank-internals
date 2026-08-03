import type { ChapterPath, ChapterUploadMetadata, DriveFile } from '@ingest/contracts';
import type { DriveService } from '../drive/index.js';

/**
 * Orchestrates filing a cut chapter PDF into Drive: ensure the nested
 * exam → subject → module → chapter folder path exists, then upload the bytes into the chapter
 * folder. Drive-only for Phase 1 — no persistence, so it depends solely on {@link DriveService}.
 */
export class IngestionService {
  constructor(private readonly driveService: DriveService) {}

  /** Ensure the exam → subject → module → chapter folder chain exists, returning the chapter id. */
  async ensureChapterPath(path: ChapterPath): Promise<string> {
    const exam = await this.driveService.findOrCreateFolder(path.exam);
    const subject = await this.driveService.findOrCreateFolder(path.subject, exam.id);
    const module = await this.driveService.findOrCreateFolder(path.module, subject.id);
    const chapter = await this.driveService.findOrCreateFolder(path.chapter, module.id);
    return chapter.id;
  }

  /** File a chapter's question/answer PDF into its Drive folder, creating the path if needed. */
  async uploadChapter(input: {
    metadata: ChapterUploadMetadata;
    bytes: Buffer;
  }): Promise<DriveFile> {
    const { metadata, bytes } = input;
    const folderId = await this.ensureChapterPath(metadata);
    const name = `${metadata.chapter}-${metadata.kind}.pdf`;
    return this.driveService.uploadPdf({ name, bytes, folderId });
  }
}
