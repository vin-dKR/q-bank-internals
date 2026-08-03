import type {
  ChapterKind,
  Document,
  DocumentListQuery,
  DocumentStatus,
  PageRange,
  QuestionType,
  SourcePath,
} from '@ingest/contracts';

/** Everything needed to persist a freshly-uploaded (or registered) section PDF. */
export type CreateDocumentInput = {
  sessionId: string | null;
  driveFileId: string;
  fileName: string;
  path: SourcePath;
  kind: ChapterKind;
  sectionName: string | null;
  questionType: QuestionType | null;
  pageRange: PageRange | null;
};

/**
 * The persistence PORT for documents (§3). This is an interface, not an implementation — the
 * service depends on this and nothing else. The Prisma-backed implementation lives in
 * `infrastructure/database/repositories/` and is wired in the composition root (§5).
 */
export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  findByDriveFileId(driveFileId: string): Promise<Document | null>;
  list(query: DocumentListQuery): Promise<{ items: Document[]; total: number }>;
  /** Statuses of every document under a session — the raw material the session summary derives from. */
  listStatusesBySession(sessionId: string): Promise<DocumentStatus[]>;
  /** Every document under a session — the worker uses this to find a question's sibling answer file. */
  listBySession(sessionId: string): Promise<Document[]>;
  create(input: CreateDocumentInput): Promise<Document>;
  updateStatus(id: string, status: DocumentStatus): Promise<Document>;
  /** Mark extraction done: sets `extracted`, stamps `extractedAt`, records how many questions landed. */
  recordExtraction(id: string, input: { questionCount: number }): Promise<Document>;
}
