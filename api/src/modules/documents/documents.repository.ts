import type {
  AnswerLayout,
  ChapterKind,
  ChapterTopic,
  Document,
  DocumentListQuery,
  DocumentStatus,
  PageRange,
  PaperMetadata,
  QuestionType,
  SourcePath,
  UpdateDocument,
} from '@ingest/contracts';

/** Identity of one upload slot within a session: the (unit · kind · fileName) a re-cut would reuse. */
export type DocumentIdentity = {
  sessionId: string | null;
  path: SourcePath;
  kind: ChapterKind;
  fileName: string;
};

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
  /** Paper-level PYQ provenance (exam name/year/session/shift/paper code …); null when not a PYQ upload. */
  paper: PaperMetadata | null;
  /** How answers are laid out in the source PDF: 'separate' (grouped/sibling) or 'inline' (with each question). */
  answerLayout: AnswerLayout;
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
  /**
   * The live (non-deleted) document occupying an upload slot — same session, unit, kind, and file
   * name. Used to dedup a re-cut/re-upload so it reuses or is rejected against the existing row
   * instead of silently creating a second copy of the same file. Null when the slot is free.
   */
  findLiveByIdentity(identity: DocumentIdentity): Promise<Document | null>;
  list(query: DocumentListQuery): Promise<{ items: Document[]; total: number }>;
  /** Statuses of every document under a session — the raw material the session summary derives from. */
  listStatusesBySession(sessionId: string): Promise<DocumentStatus[]>;
  /** Every document under a session — the worker uses this to find a question's sibling answer file. */
  listBySession(sessionId: string): Promise<Document[]>;
  create(input: CreateDocumentInput): Promise<Document>;
  /**
   * Repoint an existing row at a freshly re-uploaded file: overwrite its source (drive file + all
   * cut-time metadata) and reset it to a clean, re-runnable `uploaded` state (0 questions, no
   * `extractedAt`). This is how a re-cut of a not-yet-extracted upload replaces it in place instead
   * of spawning a duplicate row.
   */
  replaceSource(id: string, input: CreateDocumentInput): Promise<Document>;
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
  /**
   * Self-heal orphaned extractions: reset every document still `queued`/`extracting` whose last write
   * predates `olderThan` back to `failed`. Age-gated so a genuinely in-flight run is never touched —
   * the only recovery on serverless, where a frozen/dead function leaves a row stuck forever. Returns
   * how many were reset.
   */
  resetStale(olderThan: Date): Promise<number>;
}
