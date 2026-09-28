import type { Document, PageRange } from '@ingest/contracts';

/**
 * The kind of source page being read. `companion` is a single, grouped Answer + Solution PDF;
 * its destination field is selected separately by the caller.
 */
export type TopicSourceKind = 'question' | 'answer' | 'solution' | 'companion';

/** One operator-created link from a question-page span to its corresponding source-page span. */
export type TopicSourceBinding = {
  topicName: string;
  questionPageRange: PageRange;
  sourcePageRange: PageRange;
};

/** The configured topic bindings that own one physical source page. */
export type SourceTopicScope = {
  /** False means this is a legacy upload with no bindings for this source kind. */
  configured: boolean;
  bindings: TopicSourceBinding[];
};

function includesPage(range: PageRange, page: number): boolean {
  return page >= range.from && page <= range.to;
}

function rangeFor(
  block: Document['topics'][number]['types'][number],
  sourceKind: TopicSourceKind,
): PageRange | undefined {
  switch (sourceKind) {
    case 'question':
      return block.pageRange;
    case 'answer':
      return block.answerPageRange;
    case 'solution':
      return block.solutionPageRange;
    case 'companion':
      return block.companionPageRange;
  }
}

/** Every configured binding for one source kind, independent of the page currently being viewed. */
export function topicSourceBindings(
  document: Document,
  sourceKind: TopicSourceKind,
): TopicSourceBinding[] {
  const bindings: TopicSourceBinding[] = [];
  for (const topic of document.topics) {
    for (const block of topic.types) {
      const sourcePageRange = rangeFor(block, sourceKind);
      if (!sourcePageRange) continue;
      bindings.push({
        topicName: topic.name,
        questionPageRange: block.pageRange,
        sourcePageRange,
      });
    }
  }
  return bindings;
}

/**
 * Resolve the configured topic binding(s) for one source PDF page. A `configured: true` result with
 * no bindings means the page is outside the operator's cut-time mapping and must never fall back to
 * a same-number question from another topic.
 */
export function topicScopeForSourcePage(
  document: Document,
  sourceKind: TopicSourceKind,
  page: number,
): SourceTopicScope {
  const all = topicSourceBindings(document, sourceKind);
  return {
    configured: all.length > 0,
    bindings: all.filter((binding) => includesPage(binding.sourcePageRange, page)),
  };
}

/** The unique topic names represented by a scope, in deterministic document order. */
export function topicNames(scope: SourceTopicScope): string[] {
  return [...new Set(scope.bindings.map((binding) => binding.topicName))];
}

/** Does a question source page fall within one of the exact question spans paired to this source page? */
export function questionPageBelongsToBindings(
  questionPage: number,
  bindings: readonly TopicSourceBinding[],
): boolean {
  return bindings.some((binding) => includesPage(binding.questionPageRange, questionPage));
}
