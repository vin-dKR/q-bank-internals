import type { ChapterPath, ChapterUploadMetadata, Document, DriveFile } from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import type { DriveService } from '../drive/index.js';
import type { DocumentRepository } from '../documents/index.js';
import type { SessionsService } from '../sessions/index.js';
import type { ExtractionService } from '../extraction/index.js';

/** What an upload produces: the Drive file that was filed, plus the durable Document row it created. */
export type UploadChapterResult = { document: Document; driveFile: DriveFile };

/**
 * Orchestrates filing a cut chapter PDF into Drive AND recording it as a durable, session-scoped
 * Document — the breakable checkpoint that lets Phase 1 finish without waiting on Phase 2. It
 * ensures the nested exam → subject → module → chapter folder path exists, uploads the bytes, then
 * persists a Document (status `uploaded`) under the session so extraction can pick it up later.
 * When the session is in auto-run mode, it also enqueues extraction immediately (pipeline mode).
 */
export class IngestionService {
  constructor(
    private readonly driveService: DriveService,
    private readonly documents: DocumentRepository,
    private readonly sessions: SessionsService,
    private readonly extraction: ExtractionService,
  ) {}

  /** Ensure the exam → subject → module → chapter folder chain exists, returning the chapter id. */
  async ensureChapterPath(path: ChapterPath): Promise<string> {
    const exam = await this.driveService.findOrCreateFolder(path.exam);
    const subject = await this.driveService.findOrCreateFolder(path.subject, exam.id);
    const module = await this.driveService.findOrCreateFolder(path.module, subject.id);
    const chapter = await this.driveService.findOrCreateFolder(path.chapter, module.id);
    return chapter.id;
  }

  /**
   * File a chapter's question/answer PDF into its Drive folder (creating the path if needed) and
   * persist a Document under its session. Fails fast if the session is unknown, before any writes.
   */
  async uploadChapter(input: {
    metadata: ChapterUploadMetadata;
    bytes: Buffer;
  }): Promise<UploadChapterResult> {
    const { metadata, bytes } = input;
    const session = await this.sessions.getById(metadata.sessionId); // 404s here if the session is gone

    const folderId = await this.ensureChapterPath(metadata);
    const name = `${metadata.chapter}-${metadata.kind}.pdf`;
    const driveFile = await this.driveService.uploadPdf({ name, bytes, folderId });

    const document = await this.documents.create({
      sessionId: metadata.sessionId,
      driveFileId: driveFile.id,
      fileName: driveFile.name,
      path: { module: metadata.module, chapter: metadata.chapter, section: metadata.sectionName },
      kind: metadata.kind,
      sectionName: metadata.sectionName,
      questionType: metadata.questionType,
      pageRange: null,
    });

    // Pipeline mode: kick off extraction now for question PDFs. It runs on the worker, so the upload
    // response is not delayed — the "don't wait on Phase 2" guarantee still holds.
    if (session.autoRun && document.kind === 'question') {
      try {
        await this.extraction.enqueue(document.id);
      } catch (error) {
        // Never fail an upload because auto-enqueue hiccuped; the file is safely persisted either way.
        logger.warn(
          { documentId: document.id, err: error instanceof Error ? error.message : String(error) },
          'Auto-run enqueue failed; document left as uploaded',
        );
      }
    }

    return { document, driveFile };
  }
}
