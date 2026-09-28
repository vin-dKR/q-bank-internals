import type { PrismaClient } from '@prisma/client';
import type {
  AnswerLayout,
  ChapterTopic,
  Document,
  DocumentListQuery,
  DocumentStatus,
  UpdateDocument,
} from '@ingest/contracts';
import type {
  CreateDocumentInput,
  DocumentIdentity,
  DocumentRepository,
} from '../../../modules/documents/index.js';
import { notSoftDeleted } from '../prisma.js';
import { type PaperMetadataRow, toContractPaper, toPrismaPaper } from './paper-metadata-row.js';

type PageRangeRow = { from: number; to: number };
type TopicTypeRow = {
  questionType?: string | null;
  pageRange: PageRangeRow;
  answerPageRange?: PageRangeRow | null;
  solutionPageRange?: PageRangeRow | null;
  companionPageRange?: PageRangeRow | null;
  pyq?: boolean | null;
};
type TopicRow = {
  name: string;
  types: TopicTypeRow[];
  sectionName?: string | null;
  topicName?: string | null;
  subject?: string | null;
};

// Prisma's row shape for a Document, narrowed to what we map. Kept local so the mapper is the one
// place row → DTO conversion happens (§6.1: the boundary shape lives in @ingest/contracts).
type DocumentRow = {
  id: string;
  sessionId: string | null;
  driveFileId: string;
  fileName: string;
  // Legacy rows predate this column, so a read can come back without it — default to '' on map.
  uploadGroupId: string | null;
  path: { module: string; chapter: string; section: string };
  kind: string;
  sectionName: string | null;
  questionType: string | null;
  exam: string | null;
  subject: string | null;
  pyq: boolean;
  pyqExam: string | null;
  pyqYear: string | null;
  paper: PaperMetadataRow | null;
  // Legacy rows predate this column, so a read can genuinely come back without it — default on map.
  answerLayout: string | null;
  source: string | null;
  pageRange: PageRangeRow | null;
  topics: TopicRow[];
  status: DocumentStatus;
  flagged: boolean;
  questionCount: number;
  extractedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Row → contract topics: drop the null of an absent optional field back to an omitted key. */
function toContractTopics(rows: TopicRow[]): ChapterTopic[] {
  return rows.map((topic) => ({
    name: topic.name,
    types: topic.types.map((block) => ({
      ...(block.questionType ? { questionType: block.questionType } : {}),
      pageRange: block.pageRange,
      ...(block.answerPageRange ? { answerPageRange: block.answerPageRange } : {}),
      ...(block.solutionPageRange ? { solutionPageRange: block.solutionPageRange } : {}),
      ...(block.companionPageRange ? { companionPageRange: block.companionPageRange } : {}),
      ...(block.pyq ? { pyq: block.pyq } : {}),
    })),
    ...(topic.sectionName ? { sectionName: topic.sectionName } : {}),
    ...(topic.topicName ? { topicName: topic.topicName } : {}),
    ...(topic.subject ? { subject: topic.subject } : {}),
  }));
}

/** Contract → Prisma topics: an absent optional field is written as null (Prisma wants null, not undefined). */
function toPrismaTopics(topics: ChapterTopic[]): TopicRow[] {
  return topics.map((topic) => ({
    name: topic.name,
    types: topic.types.map((block) => ({
      questionType: block.questionType ?? null,
      pageRange: block.pageRange,
      answerPageRange: block.answerPageRange ?? null,
      solutionPageRange: block.solutionPageRange ?? null,
      companionPageRange: block.companionPageRange ?? null,
      pyq: block.pyq ?? null,
    })),
    sectionName: topic.sectionName ?? null,
    topicName: topic.topicName ?? null,
    subject: topic.subject ?? null,
  }));
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    sessionId: row.sessionId,
    driveFileId: row.driveFileId,
    fileName: row.fileName,
    uploadGroupId: row.uploadGroupId ?? '',
    path: row.path,
    kind: row.kind as Document['kind'],
    sectionName: row.sectionName,
    questionType: row.questionType,
    exam: row.exam,
    subject: row.subject,
    pyq: row.pyq,
    pyqExam: row.pyqExam,
    pyqYear: row.pyqYear,
    paper: toContractPaper(row.paper),
    answerLayout: (row.answerLayout ?? 'separate') as AnswerLayout,
    source: row.source,
    pageRange: row.pageRange,
    topics: toContractTopics(row.topics),
    status: row.status,
    flagged: row.flagged,
    questionCount: row.questionCount,
    extractedAt: row.extractedAt ? row.extractedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
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

  async findLiveByIdentity(identity: DocumentIdentity): Promise<Document | null> {
    // A fresh upload always mints a non-empty uploadGroupId; an empty id (never sent by a real upload)
    // must not collapse legacy rows that share the default '' — so it never matches.
    if (!identity.uploadGroupId) return null;
    const row = await this.prisma.document.findFirst({
      where: {
        sessionId: identity.sessionId,
        kind: identity.kind,
        uploadGroupId: identity.uploadGroupId,
        ...notSoftDeleted(),
      },
    });
    return row ? toDocument(row) : null;
  }

  async list(query: DocumentListQuery): Promise<{ items: Document[]; total: number }> {
    const where = {
      ...notSoftDeleted(),
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
      where: { sessionId, ...notSoftDeleted() },
      select: { status: true },
    });
    return rows.map((row) => row.status);
  }

  async listBySession(sessionId: string): Promise<Document[]> {
    const rows = await this.prisma.document.findMany({
      where: { sessionId, ...notSoftDeleted() },
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
        uploadGroupId: input.uploadGroupId,
        path: input.path,
        kind: input.kind,
        sectionName: input.sectionName,
        questionType: input.questionType,
        exam: input.exam,
        subject: input.subject,
        pyq: input.pyq,
        pyqExam: input.pyqExam,
        pyqYear: input.pyqYear,
        paper: toPrismaPaper(input.paper),
        answerLayout: input.answerLayout,
        source: input.source,
        pageRange: input.pageRange,
        topics: toPrismaTopics(input.topics),
      },
    });
    return toDocument(row);
  }

  async replaceSource(id: string, input: CreateDocumentInput): Promise<Document> {
    const row = await this.prisma.document.update({
      where: { id },
      data: {
        driveFileId: input.driveFileId,
        fileName: input.fileName,
        uploadGroupId: input.uploadGroupId,
        path: input.path,
        kind: input.kind,
        sectionName: input.sectionName,
        questionType: input.questionType,
        exam: input.exam,
        subject: input.subject,
        pyq: input.pyq,
        pyqExam: input.pyqExam,
        pyqYear: input.pyqYear,
        paper: toPrismaPaper(input.paper),
        answerLayout: input.answerLayout,
        source: input.source,
        pageRange: input.pageRange,
        topics: toPrismaTopics(input.topics),
        // Reset to a clean, re-runnable state — the prior extraction (if any) described the old file.
        status: 'uploaded',
        questionCount: 0,
        extractedAt: null,
      },
    });
    return toDocument(row);
  }

  async updateStatus(id: string, status: DocumentStatus): Promise<Document> {
    const row = await this.prisma.document.update({ where: { id }, data: { status } });
    return toDocument(row);
  }

  async update(id: string, patch: UpdateDocument): Promise<Document> {
    const row = await this.prisma.document.update({
      where: { id },
      data: {
        ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      },
    });
    return toDocument(row);
  }

  async delete(id: string): Promise<void> {
    // Soft delete: tombstone rather than remove, so the document + its questions survive for reopen.
    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { sessionId },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<Document> {
    const row = await this.prisma.document.update({ where: { id }, data: { deletedAt: null } });
    return toDocument(row);
  }

  async resetInFlight(): Promise<number> {
    const result = await this.prisma.document.updateMany({
      where: { status: { in: ['queued', 'extracting'] }, ...notSoftDeleted() },
      data: { status: 'failed' },
    });
    return result.count;
  }

  async resetStale(olderThan: Date): Promise<number> {
    const result = await this.prisma.document.updateMany({
      where: {
        status: { in: ['queued', 'extracting'] },
        updatedAt: { lt: olderThan },
        ...notSoftDeleted(),
      },
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

  async setQuestionCount(id: string, questionCount: number): Promise<Document> {
    const row = await this.prisma.document.update({ where: { id }, data: { questionCount } });
    return toDocument(row);
  }
}
