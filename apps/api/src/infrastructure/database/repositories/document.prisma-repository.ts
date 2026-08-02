import type { PrismaClient } from '@prisma/client';
import type { Document, DocumentStatus, PaginationQuery } from '@ingest/contracts';
import type { DocumentRepository } from '../../../modules/documents/index.js';

// Prisma's row shape for a Document, narrowed to what we map. Kept local so the mapper is the one
// place row → DTO conversion happens (§6.1: the boundary shape lives in @ingest/contracts).
type DocumentRow = {
  id: string;
  driveFileId: string;
  fileName: string;
  path: { module: string; chapter: string; section: string };
  status: DocumentStatus;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    driveFileId: row.driveFileId,
    fileName: row.fileName,
    path: row.path,
    status: row.status,
    questionCount: row.questionCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Production adapter for {@link DocumentRepository}, backed by MongoDB via Prisma. */
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Document | null> {
    const row = await this.prisma.document.findUnique({ where: { id } });
    return row ? toDocument(row) : null;
  }

  async findByDriveFileId(driveFileId: string): Promise<Document | null> {
    const row = await this.prisma.document.findUnique({ where: { driveFileId } });
    return row ? toDocument(row) : null;
  }

  async list(query: PaginationQuery): Promise<{ items: Document[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.document.count(),
    ]);
    return { items: rows.map(toDocument), total };
  }

  async create(input: {
    driveFileId: string;
    fileName: string;
    path: Document['path'];
  }): Promise<Document> {
    const row = await this.prisma.document.create({
      data: { driveFileId: input.driveFileId, fileName: input.fileName, path: input.path },
    });
    return toDocument(row);
  }

  async updateStatus(id: string, status: DocumentStatus): Promise<Document> {
    const row = await this.prisma.document.update({ where: { id }, data: { status } });
    return toDocument(row);
  }
}
