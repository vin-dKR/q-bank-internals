import type { ChapterTopic } from '@ingest/contracts';
import { mergeAnswerEntries, type AnswerEntry, type AnswerSheet, type ExtractedQuestion } from './vision-extractor.js';
import { normalizePrintedQuestionLabel, questionNumberFromPrintedLabel } from './question-identity.js';
import { topicBindingForPage } from './topic-lookup.js';

function normalizeSection(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

type SheetIndex = {
  byLabel: Map<string, AnswerEntry>;
  labelsByNumber: Map<number, Set<string>>;
};

type QuestionIdentity = {
  label: string | null;
  number: number | null;
  scope: string;
  topic: string | null;
};

type ScopeCounts = {
  labels: Map<string, number>;
  numbers: Map<number, number>;
};

function indexSheet(index: SheetIndex, sheet: AnswerSheet): void {
  for (const [printedLabel, entry] of Object.entries(sheet.entries)) {
    const label = normalizePrintedQuestionLabel(printedLabel);
    if (!label) continue;
    index.byLabel.set(label, mergeAnswerEntries(index.byLabel.get(label), entry));
    const number = questionNumberFromPrintedLabel(label);
    if (number === null) continue;
    const labels = index.labelsByNumber.get(number) ?? new Set<string>();
    labels.add(label);
    index.labelsByNumber.set(number, labels);
  }
}

function identityForQuestion(question: ExtractedQuestion, topics: ChapterTopic[]): QuestionIdentity {
  const label = normalizePrintedQuestionLabel(question.printedLabel) ?? (
    question.questionNumber === null ? null : String(question.questionNumber)
  );
  const topic = topicBindingForPage(topics, question.sourcePage)?.matchKey ?? null;
  return {
    label,
    number: questionNumberFromPrintedLabel(label) ?? question.questionNumber,
    scope: normalizeSection(topic ?? question.sectionName),
    topic: topic === null ? null : normalizeSection(topic),
  };
}

function matchingEntry(
  index: SheetIndex,
  identity: QuestionIdentity,
  counts: ScopeCounts,
  allowNumericFallback: boolean,
): AnswerEntry | undefined {
  if (!identity.label || counts.labels.get(identity.label) !== 1) return undefined;
  const exact = index.byLabel.get(identity.label);
  // A real printed prefix is sufficient evidence for an exact match. Bare numbers also need
  // uniqueness, because a legacy OCR pass may have discarded the exercise prefix.
  if (exact && !/^\d+$/u.test(identity.label)) return exact;
  if (!allowNumericFallback) return undefined;
  if (identity.number === null || counts.numbers.get(identity.number) !== 1) return undefined;
  const labels = index.labelsByNumber.get(identity.number);
  if (labels?.size !== 1) return undefined;
  const label = labels.values().next().value;
  if (label !== undefined && !/^\d+$/u.test(identity.label) && !/^\d+$/u.test(label)) return undefined;
  return label === undefined ? undefined : index.byLabel.get(label);
}

/**
 * Join source keys by their full printed identity within the operator's topic scope. Numeric
 * compatibility matching is permitted only when both question and key have a unique numeric
 * identity; exercise-prefix collisions and numbering restarts never borrow a flat chapter key.
 * Duplicate keys with equal authority stay unresolved instead of choosing an OCR value by page order.
 */
export function mergeAnswers(
  questions: ExtractedQuestion[],
  sheets: AnswerSheet[],
  topics: ChapterTopic[],
): ExtractedQuestion[] {
  if (sheets.length === 0) return questions;
  const bySection = new Map<string, SheetIndex>();
  for (const sheet of sheets) {
    const section = normalizeSection(sheet.sectionName);
    const index: SheetIndex = bySection.get(section) ?? { byLabel: new Map(), labelsByNumber: new Map() };
    indexSheet(index, sheet);
    bySection.set(section, index);
  }
  const soleSheet = bySection.size === 1 ? [...bySection.values()][0] : undefined;
  const identities = questions.map((question) => identityForQuestion(question, topics));
  const countsByScope = new Map<string, ScopeCounts>();
  const scopesByNumber = new Map<number, Set<string>>();
  const countsByLabel = new Map<string, number>();
  for (const identity of identities) {
    const counts: ScopeCounts = countsByScope.get(identity.scope) ?? { labels: new Map(), numbers: new Map() };
    if (identity.label) {
      counts.labels.set(identity.label, (counts.labels.get(identity.label) ?? 0) + 1);
      countsByLabel.set(identity.label, (countsByLabel.get(identity.label) ?? 0) + 1);
    }
    if (identity.number !== null) {
      counts.numbers.set(identity.number, (counts.numbers.get(identity.number) ?? 0) + 1);
      const scopes = scopesByNumber.get(identity.number) ?? new Set<string>();
      scopes.add(identity.scope);
      scopesByNumber.set(identity.number, scopes);
    }
    countsByScope.set(identity.scope, counts);
  }

  return questions.map((question, position) => {
    const identity = identities[position];
    if (!identity) return question;
    const counts = countsByScope.get(identity.scope);
    if (!counts) return question;
    const topicEntries = identity.topic === null ? undefined : bySection.get(identity.topic);
    const restarted = identity.number !== null && (scopesByNumber.get(identity.number)?.size ?? 0) > 1;
    const sectionEntries = bySection.get(normalizeSection(question.sectionName));
    const scopedSection = identity.topic === null ? sectionEntries : undefined;
    const globallyUniquePrefix = identity.label !== null && !/^\d+$/u.test(identity.label) && countsByLabel.get(identity.label) === 1;
    const index = topicEntries ?? scopedSection ?? (!restarted || globallyUniquePrefix ? sectionEntries ?? soleSheet : undefined);
    const entry = index ? matchingEntry(index, identity, counts, Boolean(topicEntries ?? scopedSection) || !restarted) : undefined;
    if (!entry) return question;
    return {
      ...question,
      answer: entry.answerConflict ? null : entry.answer ?? question.answer,
      explanation: entry.explanation ?? question.explanation,
    };
  });
}
