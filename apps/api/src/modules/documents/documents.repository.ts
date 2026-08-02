import type { Document, DocumentStatus, PaginationQuery } from '@ingest/contracts';

/**
 * The persistence PORT for documents (§3). This is an interface, not an implementation — the
 * service depends on this and nothing else. The Prisma-backed implementation lives in
 * `infrastructure/database/repositories/` and is wired in the composition root (§5).
 */
export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  findByDriveFileId(driveFileId: string): Promise<Document | null>;
  list(query: PaginationQuery): Promise<{ items: Document[]; total: number }>;
  create(input: {
    driveFileId: string;
    fileName: string;
    path: Document['path'];
  }): Promise<Document>;
  updateStatus(id: string, status: DocumentStatus): Promise<Document>;
}
