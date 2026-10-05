import {
  shouldCollectClassName,
  type ChapterPath,
  type ChapterUploadMetadata,
  type Document,
  type DriveFile,
  type SignedUploadTarget,
} from '@ingest/contracts';
import { logger } from '../../shared/logger/logger.js';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DriveService } from '../drive/index.js';
import type { CreateDocumentInput, DocumentRepository } from '../documents/index.js';
import type { SessionsService } from '../sessions/index.js';
import type { ExtractionService } from '../extraction/index.js';
import type { UploadStagingStore } from './upload-staging.store.js';

/** What an upload produces: the Drive file that was filed, plus the durable Document row it created. */
export type UploadChapterResult = { document: Document; driveFile: DriveFile };

/**
 * Give every Cut & Upload action a stable, visible suffix. Its question and supporting PDFs share
 * the same upload-group id, so operators can tell one pair from another even within one session.
 */
function fileNameForUpload(metadata: ChapterUploadMetadata): string {
  const base = metadata.chapter.trim() || metadata.exam.trim() || 'paper';
  const uploadLabel = metadata.uploadGroupId.replaceAll('-', '').slice(0, 8);
  return `${base}-${uploadLabel}-${metadata.kind}.pdf`;
}

/** The supporting parts a question upload explicitly declares through its bound page ranges. */
function requiredSupportingKinds(question: Document): Array<'answer' | 'solution' | 'companion'> {
  if (question.answerLayout === 'inline') return [];
  const hasRange = (kind: 'answer' | 'solution' | 'companion'): boolean => question.topics.some((topic) =>
    topic.types.some((block) =>
      kind === 'answer'
        ? block.answerPageRange !== undefined
        : kind === 'solution'
          ? block.solutionPageRange !== undefined
          : block.companionPageRange !== undefined,
    ),
  );
  if (question.answerLayout === 'combined') return hasRange('companion') ? ['companion'] : [];
  return [
    ...(hasRange('answer') ? ['answer' as const] : []),
    ...(hasRange('solution') ? ['solution' as const] : []),
  ];
}

/** A support document must belong to the exact upload when ids exist; legacy rows retain path pairing. */
function belongsToQuestionUpload(question: Document, candidate: Document): boolean {
  if (question.uploadGroupId && candidate.uploadGroupId)
    return question.uploadGroupId === candidate.uploadGroupId;
  return (
    question.path.module === candidate.path.module &&
    question.path.chapter === candidate.path.chapter &&
    question.path.section === candidate.path.section
  );
}

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
    private readonly staging: UploadStagingStore,
  ) {}

  /**
   * Mint a signed, single-use slot the browser uploads the PDF straight to. This is what lets a chapter
   * PDF exceed the serverless request-body limit (~4.5 MB): the bytes go to storage directly, and only
   * a small reference is finalized through {@link uploadChapter}.
   */
  async createSignedUpload(fileName: string): Promise<SignedUploadTarget> {
    return this.staging.createSignedUpload(fileName);
  }

  /**
   * Auto-run must begin only after the question's explicitly bound sources exist. Otherwise a
   * question-first browser upload can finish before its Answer/Solution PDFs are durable, leaving
   * Verify permanently without those fields. Legacy uploads without source page ranges retain their
   * previous immediate behaviour because they do not declare which supporting parts are expected.
   */
  private async enqueueReadyQuestion(sessionId: string, uploaded: Document): Promise<void> {
    const documents = await this.documents.listBySession(sessionId);
    const supportKind = uploaded.kind === 'question' ? null : uploaded.kind;
    const question = supportKind === null
      ? uploaded
      : documents.find((candidate) =>
          candidate.kind === 'question' &&
          belongsToQuestionUpload(candidate, uploaded) &&
          requiredSupportingKinds(candidate).includes(supportKind),
        );
    if (!question || question.status !== 'uploaded') return;
    const required = requiredSupportingKinds(question);
    const missing = required.filter((kind) =>
      !documents.some((candidate) => candidate.kind === kind && belongsToQuestionUpload(question, candidate)),
    );
    if (missing.length > 0) {
      logger.info(
        { documentId: question.id, missing, uploadGroupId: question.uploadGroupId },
        'Auto-run is waiting for explicitly bound answer/solution sources',
      );
      return;
    }
    try {
      await this.extraction.enqueue(question.id);
    } catch (error) {
      // Never fail an upload because auto-enqueue hiccuped; the file is safely persisted either way.
      logger.warn(
        { documentId: question.id, err: error instanceof Error ? error.message : String(error) },
        'Auto-run enqueue failed; document left as uploaded',
      );
    }
  }

  /**
   * Ensure the exam → subject → module → chapter folder chain exists, returning the deepest folder's
   * id. Blank segments are skipped (a PYQ paper may omit subject/module/chapter), so the file is filed
   * under the deepest level the operator actually named — e.g. just under the exam folder.
   */
  async ensureChapterPath(path: ChapterPath): Promise<string> {
    const segments = [path.exam, path.subject, path.module, path.chapter]
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    let parentId: string | undefined;
    for (const name of segments) {
      const folder = await this.driveService.findOrCreateFolder(name, parentId);
      parentId = folder.id;
    }
    // `exam` is always present (required for every source), so at least one folder was created.
    return parentId as string;
  }

  /**
   * File a chapter's question/answer PDF into its Drive folder (creating the path if needed) and
   * persist a Document under its session. Fails fast if the session is unknown, before any writes.
   */
  async uploadChapter(input: {
    metadata: ChapterUploadMetadata;
    storagePath: string;
  }): Promise<UploadChapterResult> {
    const { metadata, storagePath } = input;
    const session = await this.sessions.getById(metadata.sessionId); // 404s here if the session is gone
    // The browser already uploaded the PDF straight to staging; pull those bytes server-to-server (no
    // request-body limit applies here) so a large paper that couldn't fit through the function still files.
    const bytes = await this.staging.download(storagePath);

    const path = { module: metadata.module, chapter: metadata.chapter, section: metadata.sectionName };
    // A PYQ paper may omit the chapter, so fall back to the exam. The group suffix keeps repeated
    // uploads visibly distinct while staying shared by their question/answer/solution pair.
    const name = fileNameForUpload(metadata);

    // Identity is (session · uploadGroupId · kind). Only an idempotent retry of the SAME upload action
    // (same id) finds a twin — a genuine second upload mints a fresh id and creates a new document. A
    // twin already in flight / extracted is left untouched (the retry must not clobber its results).
    const twin = await this.documents.findLiveByIdentity({
      sessionId: metadata.sessionId,
      uploadGroupId: metadata.uploadGroupId,
      kind: metadata.kind,
    });
    if (twin && twin.status !== 'uploaded' && twin.status !== 'failed') {
      throw errors.documentUnitVersionExists(name, twin.status);
    }

    const folderId = await this.ensureChapterPath(metadata);
    const driveFile = await this.driveService.uploadPdf({ name, bytes, folderId });

    const createInput: CreateDocumentInput = {
      sessionId: metadata.sessionId,
      driveFileId: driveFile.id,
      fileName: name,
      uploadGroupId: metadata.uploadGroupId,
      path,
      kind: metadata.kind,
      sectionName: metadata.sectionName,
      questionType: metadata.questionType ?? null,
      // Persist the operator's per-chapter exam/subject onto the document so publish reads the
      // authoritative value from here, not the first-write-wins session backfill below.
      exam: metadata.exam,
      className: shouldCollectClassName(metadata.exam, metadata.module)
        ? metadata.className ?? null
        : null,
      subject: metadata.subject,
      pyq: metadata.pyq ?? false,
      pyqExam: metadata.pyqExam ?? null,
      pyqYear: metadata.pyqYear ?? null,
      // Paper-level PYQ provenance + answer layout, chosen once for the whole paper at cut time.
      paper: metadata.paper ?? null,
      answerLayout: metadata.answerLayout ?? 'separate',
      source: metadata.source ?? null,
      pageRange: null,
      topics: metadata.topics ?? [],
    };

    // Replace the not-yet-extracted twin in place, else create a fresh row.
    const document = twin
      ? await this.documents.replaceSource(twin.id, createInput)
      : await this.documents.create(createInput);

    // Make the (possibly auto-created) session informative by filling its exam/subject/module from
    // the first upload — only where still blank, so it never fights an operator's edit.
    await this.sessions.backfillContext(metadata.sessionId, {
      exam: metadata.exam,
      subject: metadata.subject,
      module: metadata.module,
    });

    // Pipeline mode: queue the question only once every source it explicitly binds is durable. A
    // support upload can be the final part, so it is allowed to trigger its paired question.
    if (session.autoRun) await this.enqueueReadyQuestion(metadata.sessionId, document);

    // The staged object has served its purpose now the Document + Drive file exist; drop it best-effort
    // so a failed cleanup can never fail an upload that already succeeded.
    void this.staging.remove(storagePath).catch((error: unknown) => {
      logger.warn(
        { storagePath, err: error instanceof Error ? error.message : String(error) },
        'Failed to remove staged upload after ingest',
      );
    });

    return { document, driveFile };
  }
}
