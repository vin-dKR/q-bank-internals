import type { AnswerSheet, ExtractedQuestion } from './vision-extractor.js';

/** Normalize a section name so "Exercise O-1" and "exercise o-1" match (ported from json_merger). */
function normalizeSection(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Fill each question's `answer` from the matching section's answer key — the TypeScript port of the
 * Python `JSONMerger`. Questions are matched by (normalized section name, question number). When
 * exactly one answer sheet was extracted, it is used as a fallback for questions whose section name
 * does not line up, which is the common single-section case.
 */
export function mergeAnswers(
  questions: ExtractedQuestion[],
  sheets: AnswerSheet[],
): ExtractedQuestion[] {
  if (sheets.length === 0) return questions;

  const bySection = new Map<string, Record<string, string>>();
  for (const sheet of sheets) bySection.set(normalizeSection(sheet.sectionName), sheet.answers);
  const soleSheet = sheets.length === 1 ? (sheets[0]?.answers ?? null) : null;

  return questions.map((question) => {
    if (question.questionNumber === null) return question;
    const sectionAnswers = bySection.get(normalizeSection(question.sectionName)) ?? soleSheet;
    const answer = sectionAnswers?.[String(question.questionNumber)];
    return answer ? { ...question, answer } : question;
  });
}
