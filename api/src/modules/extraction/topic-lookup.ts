import type { ChapterTopic, QuestionType } from '@ingest/contracts';

/**
 * What a page of the question PDF is bound to. `matchKey` is the topic's unique key (`topic.name`,
 * the full joined path) used to line answers/solutions up with these questions — NOT a display label.
 * `sectionName` / `topicName` are the split display identity the operator built in the v2 tree; they
 * become the question's `sectionName` / `topic` (→ bank `section_name` / `topic`). Both are absent for
 * legacy uploads and branches lacking that level, so the worker falls back to document-level values.
 */
export type TopicBinding = {
  matchKey: string;
  questionType: QuestionType;
  sectionName?: string;
  topicName?: string;
};

/**
 * Resolve which of the operator's cut-time topic/question-type blocks a question-PDF page falls in.
 * The binding is deterministic — the worker stamps it onto every question extracted from that page,
 * and the prompt states it as fixed — so the model never picks or invents a type. Returns null when
 * no block covers the page (chapter-only documents, or pages outside every block).
 */
export function topicBindingForPage(topics: ChapterTopic[], pageNumber: number): TopicBinding | null {
  for (const topic of topics) {
    for (const block of topic.types) {
      if (pageNumber >= block.pageRange.from && pageNumber <= block.pageRange.to) {
        return {
          matchKey: topic.name,
          questionType: block.questionType,
          ...(topic.sectionName ? { sectionName: topic.sectionName } : {}),
          ...(topic.topicName ? { topicName: topic.topicName } : {}),
        };
      }
    }
  }
  return null;
}
