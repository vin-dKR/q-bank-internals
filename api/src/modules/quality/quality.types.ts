import type { AiFilled, AnomalyGroup, AnomalyKind, AnomalySeverity, MatchData } from '@ingest/contracts';

/** One match-the-column column, reduced to the text a quality rule inspects. */
export type AuditMatchColumn = { title: string; entries: { body: string }[] };

/**
 * One live shared-bank `Question` row, normalized for the quality rules. The bank predates this app, so
 * every column is optional in the source; the infrastructure reader coerces absent values to null/empty.
 */
export type AuditQuestion = {
  id: string;
  ingestQuestionId: string | null;
  documentId: string | null;
  questionNumber: number | null;
  fileName: string | null;
  /** When the row was first inserted into the bank (from its ObjectId); null if the id carries no time. */
  addedAt: string | null;
  questionText: string;
  answer: string | null;
  explanation: string | null;
  options: string[];
  isQuestionImage: boolean;
  questionImage: string | null;
  isOptionImage: boolean;
  optionImages: string[];
  passage: string | null;
  passageImage: string | null;
  groupId: string | null;
  matchColumns: AuditMatchColumn[] | null;
  /** The same matching in full (columns + key), as the fix panel and the AI see it; null when absent. */
  match: MatchData | null;
  questionType: string | null;
  /** Difficulty band (`easy`/`medium`/`hard`); null on rows graded before the field existed. */
  level: string | null;
  topic: string | null;
  exam: string | null;
  subject: string | null;
  chapter: string | null;
  section: string | null;
  /** Which fields hold an AI-written value (the row's `ai_filled`); empty when none do. */
  aiFilled: AiFilled;
};

/** What a rule reports: which rule fired, on which field (null = the whole question), and why. */
export type RuleFinding = {
  kind: AnomalyKind;
  field: string | null;
  detail: string;
};

/** A rule finding bound to its question, classified, and snapshotted — ready to be tracked. */
export type DetectedAnomaly = {
  key: string;
  questionId: string;
  ingestQuestionId: string | null;
  documentId: string | null;
  kind: AnomalyKind;
  group: AnomalyGroup;
  severity: AnomalySeverity;
  field: string | null;
  detail: string;
  exam: string | null;
  subject: string | null;
  chapter: string | null;
  questionType: string | null;
  questionNumber: number | null;
  fileName: string | null;
  preview: string;
};
