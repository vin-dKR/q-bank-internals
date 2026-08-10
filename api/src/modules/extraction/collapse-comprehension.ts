import type { ExtractedQuestion } from './vision-extractor.js';

/**
 * Collapse comprehension sub-questions into ONE combined question per shared passage.
 *
 * A comprehension paper prints a passage followed by several sub-questions. The extractor returns one
 * draft per sub-question, each tagged with the same verbatim `passage`. Rather than persisting N rows
 * that each repeat the whole passage — which is what the operator saw before — this folds every group
 * that shares a passage into a single question whose text is the passage once, then each sub-question
 * (renumbered 1..n) with its own choices inline. The combined `answer` is the per-sub key ("1-B, 2-A")
 * and the `explanation` concatenates the sub-questions' worked solutions.
 *
 * The result is a plain flat question — passage + questions + answer key — so the downstream bank
 * (which has no comprehension concept) renders it like any other question. Runs AFTER the answer merge
 * so each sub-question already carries its own answer/explanation before they are combined. Drafts
 * without a passage (every non-comprehension question) pass through untouched, and order is preserved:
 * a group's combined question takes the position of its first sub-question.
 */
export function collapseComprehension(drafts: ExtractedQuestion[]): ExtractedQuestion[] {
  const groups = new Map<string, ExtractedQuestion[]>();
  // Walk once, keeping output order: a passthrough draft stays put; a passage's first sub-question
  // reserves the slot (as its group key) and later sub-questions fold into that same group.
  const order: (ExtractedQuestion | { key: string })[] = [];
  for (const draft of drafts) {
    const passage = (draft.passage ?? '').trim();
    if (passage.length === 0) {
      order.push(draft);
      continue;
    }
    const key = passageKey(passage);
    const existing = groups.get(key);
    if (existing) {
      existing.push(draft);
    } else {
      groups.set(key, [draft]);
      order.push({ key });
    }
  }
  if (groups.size === 0) return drafts;
  return order.map((item) =>
    'key' in item ? combineGroup(groups.get(item.key) ?? []) : item,
  );
}

/** Normalize a passage so trivially-different whitespace still groups its sub-questions together. */
function passageKey(passage: string): string {
  return passage.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Strip a wrapping "(…)" from an answer key so "(B)" reads as "B" in the combined key. */
function cleanAnswer(answer: string): string {
  return answer.trim().replace(/^\((.*)\)$/, '$1').trim();
}

/** Build the single combined question for one passage's sub-questions (group is non-empty). */
function combineGroup(group: ExtractedQuestion[]): ExtractedQuestion {
  const first = group[0];
  if (!first) throw new Error('collapseComprehension: empty comprehension group');
  const passage = (first.passage ?? '').trim();

  const blocks: string[] = [passage];
  const answerKeys: string[] = [];
  const explanations: string[] = [];
  group.forEach((sub, index) => {
    const n = String(index + 1);
    const lines = [`${n}. ${sub.questionText.trim()}`];
    if (sub.options.length > 0) lines.push(sub.options.map((option) => option.trim()).join('  '));
    blocks.push(lines.join('\n'));
    if (sub.answer && sub.answer.trim()) answerKeys.push(`${n}-${cleanAnswer(sub.answer)}`);
    if (sub.explanation && sub.explanation.trim()) explanations.push(`${n}. ${sub.explanation.trim()}`);
  });

  return {
    questionNumber: first.questionNumber,
    questionText: blocks.join('\n\n'),
    options: [],
    answer: answerKeys.length > 0 ? answerKeys.join(', ') : null,
    explanation: explanations.length > 0 ? explanations.join('\n\n') : null,
    sectionName: first.sectionName,
    questionType: first.questionType,
    sourcePage: first.sourcePage,
    // A comprehension block is never a match question.
    match: null,
    // Collapsed already — clear the passage so it is never re-grouped.
    passage: null,
  };
}
