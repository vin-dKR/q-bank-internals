import type { AnswerEntry, AnswerSheet, ExtractedQuestion } from './vision-extractor.js';

/** Normalize a section name so "Exercise O-1" and "exercise o-1" match (ported from json_merger). */
function normalizeSection(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Fold one sheet's entries into a section's accumulated key, giving precedence to what is already
 * there. `applyAnswers` orders sheets answers-first, so an answer sheet's answer letter is kept and a
 * later solution sheet only *fills gaps* (a missing answer, the worked explanation) rather than
 * clobbering it. Two answer sheets for the same section likewise union their question numbers instead
 * of the second replacing the first.
 */
function foldSheet(
  into: Record<string, AnswerEntry>,
  entries: Record<string, AnswerEntry>,
): void {
  for (const [questionNumber, entry] of Object.entries(entries)) {
    const existing = into[questionNumber];
    into[questionNumber] = {
      answer: existing?.answer ?? entry.answer,
      explanation: existing?.explanation ?? entry.explanation,
    };
  }
}

/**
 * Fill each question's `answer` and `explanation` from the matching section's key — the TypeScript
 * port (and extension) of the Python `JSONMerger`. Answer sheets contribute the answer letter/value;
 * solution sheets contribute the worked explanation (and back-fill an answer the sheet was missing).
 * Questions are matched by (normalized section name, question number). Sheets that share a section
 * are merged, not replaced, so an answer PDF + a solution PDF for the same chapter combine cleanly.
 * When every sheet belongs to one section it is used as a fallback for questions whose section name
 * does not line up — the common single-section case. Existing question values are never blanked.
 *
 * Correct multi-chapter mapping relies on the caller ({@link applyAnswers}) having already narrowed
 * `sheets` to the question document's own chapter unit (module + chapter + section); this function
 * then keys strictly within that unit, so a Q1 in one chapter never borrows another chapter's Q1.
 */
export function mergeAnswers(
  questions: ExtractedQuestion[],
  sheets: AnswerSheet[],
): ExtractedQuestion[] {
  if (sheets.length === 0) return questions;

  const bySection = new Map<string, Record<string, AnswerEntry>>();
  for (const sheet of sheets) {
    const section = normalizeSection(sheet.sectionName);
    const merged = bySection.get(section) ?? {};
    foldSheet(merged, sheet.entries);
    bySection.set(section, merged);
  }
  // Single-section fallback: any question can borrow the one key when its own section name differs.
  const soleSheet = bySection.size === 1 ? ([...bySection.values()][0] ?? null) : null;

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
