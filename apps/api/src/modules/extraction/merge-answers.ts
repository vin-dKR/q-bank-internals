import type { AnswerEntry, AnswerSheet, ExtractedQuestion } from './vision-extractor.js';

/** Normalize a section name so "Exercise O-1" and "exercise o-1" match (ported from json_merger). */
function normalizeSection(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Fill each question's `answer` and `explanation` from the matching section's key — the TypeScript
 * port (and extension) of the Python `JSONMerger`. Answer sheets contribute the answer letter/value;
 * solution sheets contribute the worked explanation (and back-fill an answer the sheet was missing).
 * Questions are matched by (normalized section name, question number). When exactly one sheet was
 * extracted it is used as a fallback for questions whose section name does not line up — the common
 * single-section case. Existing values already on a question are never overwritten with a blank.
 */
export function mergeAnswers(
  questions: ExtractedQuestion[],
  sheets: AnswerSheet[],
): ExtractedQuestion[] {
  if (sheets.length === 0) return questions;

  const bySection = new Map<string, Record<string, AnswerEntry>>();
  for (const sheet of sheets) bySection.set(normalizeSection(sheet.sectionName), sheet.entries);
  const soleSheet = sheets.length === 1 ? (sheets[0]?.entries ?? null) : null;

  return questions.map((question) => {
    if (question.questionNumber === null) return question;
    const sectionEntries = bySection.get(normalizeSection(question.sectionName)) ?? soleSheet;
    const entry = sectionEntries?.[String(question.questionNumber)];
    if (!entry) return question;
    return {
      ...question,
      answer: entry.answer ?? question.answer,
      explanation: entry.explanation ?? question.explanation,
    };
  });
}
