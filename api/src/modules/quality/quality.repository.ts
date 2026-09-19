import type {
  AiFilled,
  AiFilledSummary,
  AiFixField,
  AiFixSuggestion,
  AiProposal,
  Anomaly,
  AnomalyGroup,
  AnomalyKind,
  AnomalyKindCount,
  AnomalySeverity,
  AnomalyStatus,
  FixQueuePage,
  QualityFilterOptions,
  QualityScan,
  QuestionFix,
  UpdateAnomaly,
} from '@ingest/contracts';
import type { AuditQuestion, DetectedAnomaly } from './quality.types.js';

/**
 * PORT: reads every question in the LIVE shared bank for a scan, a batch at a time, oldest first. Rows
 * outside it (ingest staging, organisation-private questions) are never yielded. Never writes.
 */
export interface QuestionAuditSource {
  batches(batchSize: number): AsyncIterable<AuditQuestion[]>;
  /** One live question by its bank id; null when it is not in the live shared bank (any more). */
  findById(questionId: string): Promise<AuditQuestion | null>;
  /** Several live questions by bank id in one read; ids not in the live bank are simply absent. */
  findByIds(questionIds: string[]): Promise<AuditQuestion[]>;
  /** How many live questions hold AI-written data, overall and per field. */
  aiFilledSummary(): Promise<AiFilledSummary>;
}

/**
 * PORT: applies an operator's correction to a question. Writes the bank row AND, when the question came
 * through ingest, its staging copy — otherwise the next re-publish of that document would overwrite the
 * correction with the old extracted values.
 */
export interface QuestionFixStore {
  apply(fix: QuestionFixWrite): Promise<void>;
  /** The same write for many questions at once (the bulk plans); returns how many rows were written. */
  applyMany(fixes: QuestionFixWrite[]): Promise<number>;
}

/** One question's correction, addressed in both collections. */
export type QuestionFixWrite = {
  questionId: string;
  /** The staging row's id (`ingest_ref.question_id`); null on legacy rows, which have no staging copy. */
  ingestQuestionId: string | null;
  /** The comprehension group this question belongs to, so a passage fix reaches every row of it. */
  groupId?: string | null | undefined;
  /**
   * Taxonomy ids and labels to restamp on the BANK row (main's `examId`, `subjectId`, `chapterId`, …), when
   * the fix changed a value they are resolved from. Keys are the bank's own column names.
   */
  bankTaxonomy?: Record<string, unknown> | undefined;
  fix: QuestionFix;
  /**
   * The question's complete AI-filled tag set after this write, replacing what the row holds (empty removes
   * it). Undefined leaves the tags untouched — the bulk rule fixes never change who filled a value.
   */
  aiFilled?: AiFilled | undefined;
};

/** The minimum a scan needs to reconcile against what is already tracked. */
export type TrackedAnomaly = { id: string; key: string; questionId: string; status: AnomalyStatus };

/** Constraints for the anomaly list. Every field is optional except `status`. */
export type AnomalyFilters = {
  status: AnomalyStatus;
  group?: AnomalyGroup;
  kind?: AnomalyKind;
  severity?: AnomalySeverity;
  exam?: string;
  subject?: string;
  chapter?: string;
  q?: string;
};

export type AnomalyListPage = { anomalies: Anomaly[]; nextCursor: string | null; total: number };

/** Open problems in one subject or chapter, with the number of distinct questions they sit on. */
export type AnomalyPlaceCount = { name: string; open: number; questions: number };

/** Status totals, per-rule counts, where the problems are, and the filter values present. */
export type AnomalyTotals = {
  open: number;
  ignored: number;
  resolved: number;
  questionsWithOpen: number;
  byKind: AnomalyKindCount[];
  bySubject: AnomalyPlaceCount[];
  byChapter: AnomalyPlaceCount[];
  subjects: string[];
  chapters: string[];
};

/** PORT: the tracked anomaly set. The service owns every status rule; this only persists. */
export interface AnomalyStore {
  listTracked(): Promise<TrackedAnomaly[]>;
  createMany(anomalies: DetectedAnomaly[], seenAt: Date): Promise<void>;
  /** Overwrite each already-tracked row's detail + snapshot with the latest scan's, and stamp lastSeenAt. */
  refreshMany(updates: { id: string; anomaly: DetectedAnomaly }[], seenAt: Date): Promise<void>;
  setStatus(ids: string[], status: AnomalyStatus, resolvedAt: Date | null): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  list(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<AnomalyListPage>;
  /** The same filtered set rolled up to one row per question — the fix queue, worst severity first. */
  queue(filters: AnomalyFilters, cursor: string | null, limit: number): Promise<FixQueuePage>;
  /** Every tracked anomaly on one question, whatever its status. */
  listByQuestion(questionId: string): Promise<Anomaly[]>;
  /** The exam/subject/chapter values worth offering for this selection (each narrowed by the others). */
  filterOptions(filters: AnomalyFilters): Promise<QualityFilterOptions>;
  totals(): Promise<AnomalyTotals>;
  /** An operator's review decision on one row (clears resolvedAt); null when no row has that id. */
  updateStatus(id: string, status: ReviewStatus): Promise<Anomaly | null>;
}

/** The statuses an operator may set by hand — `resolved` is only ever set by a scan. */
export type ReviewStatus = UpdateAnomaly['status'];

export type ScanCounts = Pick<
  QualityScan,
  'questionsScanned' | 'anomaliesFound' | 'opened' | 'reopened' | 'resolved' | 'removed'
>;

/**
 * One choosable topic: its id, its text, and the chapter it belongs to. The AI is shown the ids and returns
 * one, so a topic can never be half-copied, reworded, or confused with a chapter heading.
 */
export type TopicOption = { id: string; topic: string; chapter: string };

/** One choosable chapter: the id the model answers with, and its name. */
export type ChapterOption = { id: string; chapter: string };

/** What the AI is given to place a question in a chapter when its stored chapter matched none. */
export type ChapterChoiceInput = {
  question: AuditQuestion;
  /** Where the chapters come from, e.g. "Physics (Question taxonomy)". */
  scope: string;
  chapters: ChapterOption[];
  imageUrls: string[];
};

/** The chapter id exactly as the model returned it (unchecked — the service validates it), or null. */
export type ChapterChoiceOutput = { chapterId: string | null; confidence: number; notes: string; usage: AiUsage };

/** One OpenAI call's token spend, reported so the Usage dashboard counts this feature too. */
export type AiUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
};

/** What the AI is given about one question, and which fields it is asked to work out. */
export type AiFixInput = {
  fields: AiFixField[];
  question: AuditQuestion;
  /** The only topics it may return — from the question's exam, subject and chapter — each with the id it must answer with. */
  topics: TopicOption[];
  /** The question's figures, so a diagram-dependent question can actually be solved. */
  imageUrls: string[];
  /**
   * The question type a reviewer confirmed (canonical code, e.g. `single_correct`); the answer must fit it.
   * Null on an ordinary run, where a mismatch is reported to the reviewer instead of prevented.
   */
  confirmedType: string | null;
};

/** The model name is reported once, on `usage`, and answer checks are the service's; it adds both. */
export type AiFixOutput = { suggestion: Omit<AiFixSuggestion, 'model' | 'answerWarnings'>; usage: AiUsage };

/** PORT: the model that reads a question and works out its topic, answer, solution and level. */
export interface QuestionAiFixer {
  fix(input: AiFixInput): Promise<AiFixOutput>;
  /** Place a question in one of a subject's chapters, so its topic is then chosen inside that chapter only. */
  chooseChapter(input: ChapterChoiceInput): Promise<ChapterChoiceOutput>;
}

/** A proposal as it is stored: the contract shape minus the id the store assigns. */
/**
 * `questionType` and both warning lists are worked out live from the question when listing (a type corrected
 * elsewhere must clear its warning), so they are never stored.
 */
export type NewAiProposal = Omit<
  AiProposal,
  'id' | 'createdAt' | 'decidedAt' | 'status' | 'questionType' | 'answerWarnings' | 'structureWarnings'
>;

export type AiProposalPageResult = { proposals: AiProposal[]; nextCursor: string | null; total: number };

/** PORT: AI proposals awaiting review. Writing one never touches the bank. */
export interface AiProposalStore {
  /** One row per question: a re-run replaces the previous pending proposal. */
  save(proposal: NewAiProposal, at: Date): Promise<void>;
  list(status: AiProposal['status'], cursor: string | null, limit: number): Promise<AiProposalPageResult>;
  findPending(ids: string[] | null, minConfidence: number | null): Promise<AiProposal[]>;
  setStatus(ids: string[], status: AiProposal['status'], at: Date): Promise<void>;
  countPending(): Promise<number>;
}

/** PORT: the scan run log. */
export interface QualityScanStore {
  latest(): Promise<QualityScan | null>;
  list(limit: number): Promise<QualityScan[]>;
  start(startedAt: Date): Promise<QualityScan>;
  complete(id: string, counts: ScanCounts, finishedAt: Date): Promise<QualityScan>;
  fail(id: string, error: string, finishedAt: Date): Promise<void>;
}
