import type { AiFilledSummary } from '@ingest/contracts';
import type { AuditQuestion, QuestionAuditSource } from '../../modules/quality/index.js';

/**
 * Null-object {@link QuestionAuditSource} for the in-memory dev driver — auditing the bank needs a real
 * database. Yields nothing, so a scan completes with zero questions and the dashboard shows its empty state.
 */
export class UnconfiguredQuestionAuditSource implements QuestionAuditSource {
  findById(): Promise<AuditQuestion | null> {
    return Promise.resolve(null);
  }

  findByIds(): Promise<AuditQuestion[]> {
    return Promise.resolve([]);
  }

  aiFilledSummary(): Promise<AiFilledSummary> {
    return Promise.resolve({ questions: 0, byField: { topic: 0, answer: 0, solution: 0, level: 0, structure: 0 } });
  }

  batches(): AsyncIterable<AuditQuestion[]> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined }),
      }),
    };
  }
}
