import type { PrismaClient } from '@prisma/client';
import type { ChapterTopic, Document, DocumentListQuery, DocumentStatus } from '@ingest/contracts';
import type { CreateDocumentInput, DocumentRepository } from '../../../modules/documents/index.js';

type PageRangeRow = { from: number; to: number };
type TopicTypeRow = {
  questionType: string;
  pageRange: PageRangeRow;
  answerPageRange?: PageRangeRow | null;
  solutionPageRange?: PageRangeRow | null;
};

// Prisma's row shape for a Document, narrowed to what we map. Kept local so the mapper is the one
// place row → DTO conversion happens (§6.1: the boundary shape lives in @ingest/contracts).
type DocumentRow = {
  id: string;
  sessionId: string | null;
  driveFileId: string;
  fileName: string;
  path: { module: string; chapter: string; section: string };
  kind: string;
  sectionName: string | null;
  questionType: string | null;
  source: string | null;
  pageRange: PageRangeRow | null;
  topics: { name: string; types: TopicTypeRow[] }[];
  status: DocumentStatus;
  questionCount: number;
  extractedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Row → contract topics: drop the null of an absent optional range back to an omitted key. */
function toContractTopics(rows: { name: string; types: TopicTypeRow[] }[]): ChapterTopic[] {
  return rows.map((topic) => ({
    name: topic.name,
    types: topic.types.map((block) => ({
      questionType: block.questionType,
      pageRange: block.pageRange,
      ...(block.answerPageRange ? { answerPageRange: block.answerPageRange } : {}),
      ...(block.solutionPageRange ? { solutionPageRange: block.solutionPageRange } : {}),
    })),
  }));
}

/** Contract → Prisma topics: an absent optional range is written as null (Prisma wants null, not undefined). */
function toPrismaTopics(topics: ChapterTopic[]): { name: string; types: TopicTypeRow[] }[] {
  return topics.map((topic) => ({
    name: topic.name,
    types: topic.types.map((block) => ({
      questionType: block.questionType,
      pageRange: block.pageRange,
      answerPageRange: block.answerPageRange ?? null,
      solutionPageRange: block.solutionPageRange ?? null,
    })),
  }));
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    sessionId: row.sessionId,
    driveFileId: row.driveFileId,
    fileName: row.fileName,
    path: row.path,
    kind: row.kind as Document['kind'],
    sectionName: row.sectionName,
    questionType: row.questionType,
    source: row.source,
    pageRange: row.pageRange,
    topics: toContractTopics(row.topics),
    status: row.status,
    questionCount: row.questionCount,
    extractedAt: row.extractedAt ? row.extractedAt.toISOString() : null,
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

  async list(query: DocumentListQuery): Promise<{ items: Document[]; total: number }> {
    const where = {
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.status ? { status: { in: query.status } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.document.count({ where }),
    ]);
    return { items: rows.map(toDocument), total };
  }

  async listStatusesBySession(sessionId: string): Promise<DocumentStatus[]> {
    const rows = await this.prisma.document.findMany({
      where: { sessionId },
      select: { status: true },
    });
    return rows.map((row) => row.status);
  }

  async listBySession(sessionId: string): Promise<Document[]> {
    const rows = await this.prisma.document.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDocument);
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    const row = await this.prisma.document.create({
      data: {
        sessionId: input.sessionId,
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        path: input.path,
        kind: input.kind,
        sectionName: input.sectionName,
        questionType: input.questionType,
        source: input.source,
        pageRange: input.pageRange,
        topics: toPrismaTopics(input.topics),
      },
    });
    return toDocument(row);
  }

  async updateStatus(id: string, status: DocumentStatus): Promise<Document> {
    const row = await this.prisma.document.update({ where: { id }, data: { status } });
    return toDocument(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.document.delete({ where: { id } });
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.prisma.document.deleteMany({ where: { sessionId } });
  }

  async resetInFlight(): Promise<number> {
    const result = await this.prisma.document.updateMany({
      where: { status: { in: ['queued', 'extracting'] } },
      data: { status: 'failed' },
    });
    return result.count;
  }

  async recordExtraction(id: string, input: { questionCount: number }): Promise<Document> {
    const row = await this.prisma.document.update({
      where: { id },
      data: { status: 'extracted', questionCount: input.questionCount, extractedAt: new Date() },
    });
    return toDocument(row);
  }
}
