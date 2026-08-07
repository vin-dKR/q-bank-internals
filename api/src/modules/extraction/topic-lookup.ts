import type { ChapterTopic, QuestionType } from '@ingest/contracts';

/** The topic + predefined question type a page of the question PDF is bound to. */
export type TopicBinding = { topicName: string; questionType: QuestionType };

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
        return { topicName: topic.name, questionType: block.questionType };
      }
    }
  }
  return null;
}
