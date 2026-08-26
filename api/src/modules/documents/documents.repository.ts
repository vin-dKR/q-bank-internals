import type {
  ChapterKind,
  ChapterTopic,
  Document,
  DocumentListQuery,
  DocumentStatus,
  PageRange,
  QuestionType,
  SourcePath,
  UpdateDocument,
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
  /** Exam + subject the operator picked for this chapter; null when unknown (legacy/register). */
  exam: string | null;
  subject: string | null;
  /** PYQ provenance: whether the chapter is previous-year questions, plus the exam + year asked. */
  pyq: boolean;
  pyqExam: string | null;
  pyqYear: string | null;
  /** Question provenance (pyq / module / textbook); null when the operator left it blank. */
  source: string | null;
  pageRange: PageRange | null;
  /** Topic → question-type config of a question PDF; empty when the chapter has no topic structure. */
  topics: ChapterTopic[];
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
  /** Apply an operator edit to a document (currently just the manual-fix flag). */
  update(id: string, patch: UpdateDocument): Promise<Document>;
  /** Mark extraction done: sets `extracted`, stamps `extractedAt`, records how many questions landed. */
  recordExtraction(id: string, input: { questionCount: number }): Promise<Document>;
  /** Soft-delete: tombstone the document so it hides from listings but stays fetchable by id. */
  delete(id: string): Promise<void>;
  /** Soft-delete every document under a session (used when the session itself is removed). */
  deleteBySession(sessionId: string): Promise<void>;
  /** Clear a document's soft-delete tombstone so it reappears; returns the restored row. */
  restore(id: string): Promise<Document>;
  /** Reset documents left `queued`/`extracting` (e.g. a dead in-process worker) back to `failed`. */
  resetInFlight(): Promise<number>;
}
