import { randomUUID } from 'node:crypto';
import type { Document, DocumentListQuery, DocumentStatus } from '@ingest/contracts';
import type { CreateDocumentInput, DocumentRepository } from '../../../modules/documents/index.js';

/**
 * Dev/test adapter for {@link DocumentRepository}. Keeps documents in a Map so the app runs with no
 * database. Swapped for the Prisma adapter in production via DB_DRIVER (wired in the container).
 * Methods return resolved promises (no `await`) to satisfy the async port without a real backend.
 */
export class InMemoryDocumentRepository implements DocumentRepository {
  private readonly store = new Map<string, Document>();

  findById(id: string): Promise<Document | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findByDriveFileId(driveFileId: string): Promise<Document | null> {
    for (const doc of this.store.values()) {
      if (doc.driveFileId === driveFileId) return Promise.resolve(doc);
    }
    return Promise.resolve(null);
  }

  list(query: DocumentListQuery): Promise<{ items: Document[]; total: number }> {
    const filtered = [...this.store.values()]
      .filter((doc) => (query.sessionId ? doc.sessionId === query.sessionId : true))
      .filter((doc) => (query.status ? query.status.includes(doc.status) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: filtered.slice(start, start + query.pageSize),
      total: filtered.length,
    });
  }

  listStatusesBySession(sessionId: string): Promise<DocumentStatus[]> {
    const statuses = [...this.store.values()]
      .filter((doc) => doc.sessionId === sessionId)
      .map((doc) => doc.status);
    return Promise.resolve(statuses);
  }

  listBySession(sessionId: string): Promise<Document[]> {
    return Promise.resolve([...this.store.values()].filter((doc) => doc.sessionId === sessionId));
  }

  create(input: CreateDocumentInput): Promise<Document> {
    const now = new Date().toISOString();
    const document: Document = {
      id: randomUUID(),
      sessionId: input.sessionId,
      driveFileId: input.driveFileId,
      fileName: input.fileName,
      path: input.path,
      kind: input.kind,
      sectionName: input.sectionName,
      questionType: input.questionType,
      pageRange: input.pageRange,
      status: 'uploaded',
      questionCount: 0,
      extractedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(document.id, document);
    return Promise.resolve(document);
  }

  updateStatus(id: string, status: DocumentStatus): Promise<Document> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Document ${id} vanished from the in-memory store.`);
    const updated: Document = { ...existing, status, updatedAt: new Date().toISOString() };
    this.store.set(id, updated);
    return Promise.resolve(updated);
  }

  recordExtraction(id: string, input: { questionCount: number }): Promise<Document> {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Document ${id} vanished from the in-memory store.`);
    const now = new Date().toISOString();
    const updated: Document = {
      ...existing,
      status: 'extracted',
      questionCount: input.questionCount,
      extractedAt: now,
      updatedAt: now,
    };
    this.store.set(id, updated);
    return Promise.resolve(updated);
  }
}
