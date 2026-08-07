import { KNOWN_QUESTION_TYPES, type ChapterTopic } from '@ingest/contracts';
import type { SplitPointsByPage } from '../types/split-point.js';
import type { TopicDraft } from '../types/chapter-group.js';
import {
  type PageKinds,
  type PageRange,
  type SliceRef,
  type SliceTags,
  sliceKind,
  slicesForRange,
} from './build-chapter-pdfs.js';

/** Everything needed to resolve a chapter's question slices, which topic blocks bind to. */
export type TopicSliceContext = {
  range: PageRange;
  splitPoints: SplitPointsByPage;
  tags: SliceTags;
  pageKinds?: PageKinds | undefined;
};

const PREDEFINED_TYPES = new Set<string>(KNOWN_QUESTION_TYPES);

/** The chapter's question-kind slices — the material a topic's question-type blocks bind to. */
function questionSlices(context: TopicSliceContext): SliceRef[] {
  return slicesForRange(context.range, context.splitPoints).filter(
    (slice) => sliceKind(slice, context.tags, context.pageKinds) === 'question',
  );
}

/**
 * Validate a chapter's topic drafts before upload; returns a user-facing reason when invalid, else
 * null. Enforces the config's guarantees: every type is from the predefined list, every block sits
 * inside the chapter and covers at least one question-tagged slice, and no two blocks overlap (an
 * overlap would make the page → topic/type mapping ambiguous).
 */
export function topicsError(topics: TopicDraft[], context: TopicSliceContext): string | null {
  const slices = questionSlices(context);
  const spans: { label: string; from: number; to: number }[] = [];

  for (const [index, topic] of topics.entries()) {
    const label = topic.name.trim() || `Topic ${String(index + 1)}`;
    if (!topic.name.trim()) return `${label}: give the topic a name.`;
    if (topic.types.length === 0) return `${label}: add at least one question type.`;
    for (const block of topic.types) {
      if (!PREDEFINED_TYPES.has(block.questionType)) {
        return `${label}: pick a question type from the predefined list.`;
      }
      const blockLabel = `${label} (${block.questionType})`;
      if (block.from > block.to || block.from < context.range.from || block.to > context.range.to) {
        return `${blockLabel}: pages ${String(block.from)}–${String(block.to)} fall outside the chapter's ${String(context.range.from)}–${String(context.range.to)}.`;
      }
      if (!slices.some((s) => s.pageNumber >= block.from && s.pageNumber <= block.to)) {
        return `${blockLabel}: no question-tagged slices on pages ${String(block.from)}–${String(block.to)}.`;
      }
      spans.push({ label: blockLabel, from: block.from, to: block.to });
    }
  }

  spans.sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const current = spans[i];
    if (prev && current && current.from <= prev.to) {
      return `${prev.label} and ${current.label} overlap — give each question type its own page span.`;
    }
  }
  return null;
}

/**
 * Convert validated topic drafts (source-page spans) into the persisted {@link ChapterTopic} config,
 * re-expressed in the built question PDF's page space via `questionPageBySlice` — the pages
 * extraction actually rasterizes. Blocks whose slices all collapsed to zero-area cells (and so never
 * reached the built PDF) are dropped; validation makes that a degenerate edge, not a normal path.
 */
export function builtTopics(
  topics: TopicDraft[],
  context: TopicSliceContext,
  questionPageBySlice: Record<string, number>,
): ChapterTopic[] {
  const slices = questionSlices(context);
  const result: ChapterTopic[] = [];
  for (const topic of topics) {
    const types: ChapterTopic['types'] = [];
    for (const block of topic.types) {
      const pages = slices
        .filter((slice) => slice.pageNumber >= block.from && slice.pageNumber <= block.to)
        .map((slice) => questionPageBySlice[slice.id])
        .filter((page): page is number => page !== undefined);
      if (pages.length === 0) continue;
      types.push({
        questionType: block.questionType,
        pageRange: { from: Math.min(...pages), to: Math.max(...pages) },
      });
    }
    if (types.length > 0) result.push({ name: topic.name.trim(), types });
  }
  return result;
}
