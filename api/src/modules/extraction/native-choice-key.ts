import type { AnswerSheet } from './vision-extractor.js';
import { normalizePrintedQuestionLabel } from './question-identity.js';

/** Only complete, explicitly requested identities may use a local compact-choice key. */
export function nativeChoiceSheet(
  keys: Record<string, string> | null | undefined,
  expectedLabels: string[] | undefined,
  sectionName: string | null,
): AnswerSheet | null {
  if (!keys || !expectedLabels || expectedLabels.length === 0) return null;
  const labels: string[] = [];
  for (const expected of expectedLabels) {
    const label = normalizePrintedQuestionLabel(expected);
    if (label === null) return null;
    labels.push(label);
  }
  if (new Set(labels).size !== labels.length) return null;
  const entries: AnswerSheet['entries'] = {};
  for (const label of labels) {
    const answer = keys[label]?.trim().toUpperCase();
    if (!answer || !/^[A-D]$/u.test(answer)) return null;
    entries[label] = { answer, explanation: null, answerSource: 'answer_key' };
  }
  return {
    sectionName,
    entries,
  };
}
