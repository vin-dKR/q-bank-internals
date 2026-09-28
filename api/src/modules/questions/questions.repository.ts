import type {
  AiFilled,
  ImageCrop,
  MatchData,
  PaperMetadata,
  Passage,
  Question,
  QuestionImage,
  QuestionOption,
  SourcePath,
  UpdatePassage,
  UpdateQuestion,
} from '@ingest/contracts';

/** A question draft ready to persist — the extraction worker maps model output into this shape. */
export type NewQuestion = {
  documentId: string;
  questionNumber: number | null;
  path: SourcePath;
  stem: string;
  options: QuestionOption[];
  answer: string;
  match: MatchData | null;
  // Comprehension grouping (BLA-125, v2): the id of the shared {@link NewPassage} this sub-question
  // belongs to (null on ordinary questions), and its 0-based order within that group. The passage
  // text/image live ONCE on the Passage row, never copied onto the question.
  passageId: string | null;
  groupOrder: number | null;
  explanation: string | null;
  images: QuestionImage[];
  questionType: string | null;
  // Per-question difficulty (easy|medium|hard) the AI classified; null when it gave nothing usable.
  level: string | null;
  /** Provenance for AI-written values, including the extraction-time difficulty classification. */
  aiFilled: AiFilled | null;
  sectionName: string | null;
  topic: string | null;
  /** CBSE grade copied from the source document; null for non-CBSE/legacy rows. */
  className: string | null;
  // Per-question subject stamped from the node's subject; null falls back to the document at publish.
  subject: string | null;
  // Per-question PYQ provenance stamped from the segment toggle + what the model read on the page.
  isPyq: boolean;
  pyqExam: string | null;
  pyqYear: string | null;
  // Paper-level PYQ provenance denormalized from the document; null on non-PYQ / legacy uploads.
  paper: PaperMetadata | null;
  sourceRegion: { page: number; bbox: [number, number, number, number] };
};

/**
 * A shared comprehension passage ready to persist (BLA-125, v2) — one per group in a document. `id` is
 * the group's deterministic identity (also stamped as the bank group_id on publish); `contentHash` is
 * the within-document dedup key. The passage text/image are stored here ONCE, not on every sub-question.
 */
export type NewPassage = {
  id: string;
  documentId: string;
  text: string;
  contentHash: string;
  passageImage: string | null;
  imageCrops: ImageCrop[];
};

/**
 * Persistence PORT for extracted questions + their comprehension passages (§3). Deliberately small: the
 * worker re-extracts a whole document at once, so it replaces that document's questions AND passages
 * wholesale — which also makes re-running a document idempotent. Implemented in-memory (dev) and via
 * Prisma (prod).
 */
export interface QuestionRepository {
  /**
   * Replace all questions AND passages for a document with the given drafts (wholesale). Passages are
   * written before questions so every `passageId` resolves. Returns how many QUESTIONS were written —
   * passages are group metadata and are never counted as questions.
   */
  replaceDocument(documentId: string, passages: NewPassage[], questions: NewQuestion[]): Promise<number>;
  /**
   * Read back the questions extracted from a document, in PDF reading order (printed question
   * number, falling back to page + position — see `question-order.ts`, with a comprehension group
   * ordered by `groupOrder`). Verify and publish both rely on this order matching the sheet.
   */
  findByDocument(documentId: string): Promise<Question[]>;
  /** Read one staged question so service-side invariants can normalize a partial verify patch safely. */
  findById(id: string): Promise<Question | null>;
  /** Read the comprehension passages for a document (empty when the document has no groups). */
  findPassagesByDocument(documentId: string): Promise<Passage[]>;
  /** Apply verify-screen edits (image flags/urls, stem, options, answer) to one question. */
  update(id: string, patch: UpdateQuestion): Promise<Question>;
  /** Apply verify-screen edits (text / shared image) to one comprehension passage — fixed in ONE place. */
  updatePassage(id: string, patch: UpdatePassage): Promise<Passage>;
  /**
   * Manually group `questionIds` (in the given order) into a NEW comprehension passage `passageId`
   * (empty text). Points each question's passageId at it and stamps groupOrder 0..n-1; any passage left
   * with no members is removed. Returns the created passage. The verify "group into comprehension" fix-up.
   */
  groupQuestions(documentId: string, passageId: string, questionIds: string[]): Promise<Passage>;
  /** Dissolve a comprehension group: clear passageId/groupOrder on its members and delete the passage. */
  ungroupPassage(passageId: string): Promise<void>;
  /** Remove all questions AND passages for a document (called when the document/session is deleted). */
  deleteByDocument(documentId: string): Promise<void>;
  /**
   * Hard-delete ONE question (the verify "Delete" action), pruning its comprehension passage when it
   * was the group's last member. Returns the deleted question — so the caller can drop its published
   * bank copy and refresh the document's count — or null when no question had that id.
   */
  deleteById(id: string): Promise<Question | null>;
  /** How many questions the document currently holds — to refresh its denormalized `questionCount`. */
  countByDocument(documentId: string): Promise<number>;
}
