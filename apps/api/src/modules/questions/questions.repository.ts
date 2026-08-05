import type {
  Question,
  QuestionImage,
  QuestionOption,
  SourcePath,
  UpdateQuestion,
} from '@ingest/contracts';

/** A question draft ready to persist — the extraction worker maps model output into this shape. */
export type NewQuestion = {
  documentId: string;
  path: SourcePath;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string | null;
  images: QuestionImage[];
  questionType: string | null;
  sectionName: string | null;
  topic: string | null;
  sourceRegion: { page: number; bbox: [number, number, number, number] };
};

/**
 * Persistence PORT for extracted questions (§3). Deliberately small: the worker re-extracts a whole
 * document at once, so it replaces that document's questions wholesale — which also makes re-running
 * a document idempotent. Implemented in-memory (dev) and via Prisma (prod).
 */
export interface QuestionRepository {
  /** Replace all questions for a document with the given drafts; returns how many were written. */
  replaceForDocument(documentId: string, questions: NewQuestion[]): Promise<number>;
  /** Read back the questions extracted from a document (the verify/preview screen). */
  findByDocument(documentId: string): Promise<Question[]>;
  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to one question. */
  update(id: string, patch: UpdateQuestion): Promise<Question>;
  /** Remove all questions for a document (called when the document/session is deleted). */
  deleteByDocument(documentId: string): Promise<void>;
}
