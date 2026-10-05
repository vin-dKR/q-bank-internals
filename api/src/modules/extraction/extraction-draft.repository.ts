import type { AnswerSheet, ExtractedQuestion } from './vision-extractor.js';

/** A committed question-page response. It is a durable token-spend checkpoint, not a final row. */
export type QuestionPageDraft = {
  pageNumber: number;
  questions: ExtractedQuestion[];
};

/** A committed page of an answer/solution sheet, retained for final reconciliation. */
export type SheetPageDraft = {
  documentId: string;
  phase: 'answer' | 'solution' | 'companion';
  pageNumber: number;
  scopeKey: string;
  sheets: AnswerSheet[];
};

/** Counts used to advance the visible job progress without double-counting a retried queue message. */
export type QuestionDraftProgress = { pagesDone: number; questionsFound: number };

/**
 * Persistent page-level extraction checkpoints. The queue is at-least-once, therefore every write
 * is keyed by job + source document + phase + page + scope and is safe to repeat.
 */
export interface ExtractionDraftStore {
  saveQuestionPage(input: { jobId: string; documentId: string; pageNumber: number; questions: ExtractedQuestion[] }): Promise<void>;
  findQuestionPages(jobId: string): Promise<QuestionPageDraft[]>;
  questionProgress(jobId: string): Promise<QuestionDraftProgress>;
  saveSheetPage(input: SheetPageDraft & { jobId: string }): Promise<void>;
  findSheetPages(jobId: string): Promise<SheetPageDraft[]>;
  deleteByJob(jobId: string): Promise<void>;
}
