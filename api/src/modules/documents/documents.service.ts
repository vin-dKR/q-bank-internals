import type { Document, DocumentListQuery, RegisterDocument, UpdateDocument } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { SessionRepository } from '../sessions/index.js';
import type { DocumentRepository } from './documents.repository.js';

type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number };

/**
 * All business rules for pipeline documents. Depends only on the repository PORTs (§3) —
 * it has no idea whether the store is Mongo or in-memory, and it never sees an HTTP request.
 */
export class DocumentsService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly sessions: SessionRepository,
    private readonly staleExtractionMs: number,
  ) {}

  /** List documents, optionally narrowed by session and/or status — powers the operator filter. */
  async list(query: DocumentListQuery): Promise<Paginated<Document>> {
    // Self-heal first: an orphaned `extracting` row (dead/frozen worker) is reset to `failed` so the
    // file rows never show a run that will never finish. Age-gated, so a live run is never touched.
    await this.documents.resetStale(new Date(Date.now() - this.staleExtractionMs));
    const { items, total } = await this.documents.list(query);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getById(id: string): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) throw errors.documentNotFound(id);
    return document;
  }

  /** Edit a document (currently only the operator's manual-fix flag). */
  async update(id: string, patch: UpdateDocument): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) throw errors.documentNotFound(id);
    return this.documents.update(id, patch);
  }

  /**
   * Soft-delete a document: it hides from listings but its extracted questions survive, so a
   * published question can reopen (and restore) its source later. Not a destructive delete.
   */
  async delete(id: string): Promise<void> {
    const document = await this.documents.findById(id);
    if (!document) throw errors.documentNotFound(id);
    await this.documents.delete(id);
  }

  /**
   * Restore a soft-deleted document (and its parent session) so it reappears in the pipeline — the
   * "get the session back" path taken when a published question is edited. Idempotent: restoring a
   * document that was never deleted is a harmless no-op.
   */
  async restore(id: string): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) throw errors.documentNotFound(id);
    const restored = await this.documents.restore(id);
    if (restored.sessionId) await this.sessions.restore(restored.sessionId);
    return restored;
  }

  async register(input: RegisterDocument): Promise<Document> {
    const existing = await this.documents.findByDriveFileId(input.driveFileId);
    if (existing) {
      // A live registration of this Drive file already exists — reject as before. But if the prior
      // document was soft-deleted, re-registering the same file brings it back instead of failing.
      if (existing.deletedAt === null) throw errors.documentAlreadyRegistered(input.driveFileId);
      return this.restore(existing.id);
    }
    return this.documents.create({
      sessionId: input.sessionId ?? null,
      driveFileId: input.driveFileId,
      fileName: input.fileName,
      path: input.path,
      kind: input.kind,
      sectionName: input.sectionName ?? null,
      questionType: input.questionType ?? null,
      exam: input.exam ?? null,
      subject: input.subject ?? null,
      pyq: input.pyq ?? false,
      pyqExam: input.pyqExam ?? null,
      pyqYear: input.pyqYear ?? null,
      paper: input.paper ?? null,
      answerLayout: input.answerLayout ?? 'separate',
      source: input.source ?? null,
      pageRange: input.pageRange ?? null,
      topics: input.topics ?? [],
    });
  }
}
