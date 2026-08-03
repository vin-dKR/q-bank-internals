import type { Document, DocumentListQuery, RegisterDocument } from '@ingest/contracts';
import { errors } from '../../shared/errors/error-catalog.js';
import type { DocumentRepository } from './documents.repository.js';

type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number };

/**
 * All business rules for pipeline documents. Depends only on the repository PORT (§3) —
 * it has no idea whether the store is Mongo or in-memory, and it never sees an HTTP request.
 */
export class DocumentsService {
  constructor(private readonly documents: DocumentRepository) {}

  /** List documents, optionally narrowed by session and/or status — powers the operator filter. */
  async list(query: DocumentListQuery): Promise<Paginated<Document>> {
    const { items, total } = await this.documents.list(query);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getById(id: string): Promise<Document> {
    const document = await this.documents.findById(id);
    if (!document) throw errors.documentNotFound(id);
    return document;
  }

  async register(input: RegisterDocument): Promise<Document> {
    const existing = await this.documents.findByDriveFileId(input.driveFileId);
    if (existing) throw errors.documentAlreadyRegistered(input.driveFileId);
    return this.documents.create({
      sessionId: input.sessionId ?? null,
      driveFileId: input.driveFileId,
      fileName: input.fileName,
      path: input.path,
      kind: input.kind,
      sectionName: input.sectionName ?? null,
      questionType: input.questionType ?? null,
      pageRange: input.pageRange ?? null,
    });
  }
}
