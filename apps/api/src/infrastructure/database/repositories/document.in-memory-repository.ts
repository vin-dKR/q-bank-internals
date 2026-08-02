import { randomUUID } from 'node:crypto';
import type { Document, DocumentStatus, PaginationQuery } from '@ingest/contracts';
import type { DocumentRepository } from '../../../modules/documents/index.js';

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

  list(query: PaginationQuery): Promise<{ items: Document[]; total: number }> {
    const all = [...this.store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({ items: all.slice(start, start + query.pageSize), total: all.length });
  }

  create(input: {
    driveFileId: string;
    fileName: string;
    path: Document['path'];
  }): Promise<Document> {
    const now = new Date().toISOString();
    const document: Document = {
      id: randomUUID(),
      driveFileId: input.driveFileId,
      fileName: input.fileName,
      path: input.path,
      status: 'uploaded',
      questionCount: 0,
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
}
