import type { CatalogQuestion } from '@ingest/contracts';
import type {
  PassageViewModel,
  QuestionViewMatch,
  QuestionViewModel,
  QuestionViewOption,
} from '../../../shared/ui/index.js';

/** A/B/C… label for the option at `index` — the fallback when a stored option has no "(A)" prefix. */
function fallbackLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** The correct-answer tokens: the bank stores answers as a comma list of letters or 1-based numbers. */
function correctTokens(answer: string | null): Set<string> {
  if (!answer) return new Set();
  return new Set(answer.split(',').map((token) => token.trim().toUpperCase()).filter(Boolean));
}

/** Split a bank option ("(A) body") into its printed label + body; an unprefixed option falls back to A/B/C. */
function splitOption(raw: string, index: number): { label: string; body: string } {
  const match = /^\s*\(([^)]+)\)\s*/.exec(raw);
  if (match?.[1]) return { label: match[1].trim(), body: raw.slice(match[0].length) };
  return { label: fallbackLabel(index), body: raw };
}

/** Split a comma-separated image field into individual URLs (the bank packs figures this way). */
function splitUrls(value: string | null): string[] {
  return value ? value.split(',').map((url) => url.trim()).filter(Boolean) : [];
}

/**
 * Map a published {@link CatalogQuestion} into the shared {@link QuestionViewModel}, so the browse renders
 * through the same component every surface uses. This is where the bank's flattened shape is un-flattened:
 * the `"(A) body"` option strings recover their printed label (killing the old double-label), the
 * comma-packed `questionImage` splits into real figures, and each option is paired with its `optionImages`
 * entry so text AND image show together instead of one XOR the other.
 */
export function catalogQuestionToView(question: CatalogQuestion): QuestionViewModel {
  const correct = correctTokens(question.answer);
  const options: QuestionViewOption[] = question.options.map((raw, index) => {
    const { label, body } = splitOption(raw, index);
    return {
      label,
      body,
      isCorrect: correct.has(label.toUpperCase()) || correct.has(String(index + 1)),
      image: question.isOptionImage ? question.optionImages[index] ?? null : null,
    };
  });
  const match: QuestionViewMatch | null = question.match
    ? { columns: question.match.columns, key: question.match.key }
    : null;
  return {
    number: question.questionNumber,
    type: question.questionType,
    stem: question.questionText,
    questionImages: question.isQuestionImage ? splitUrls(question.questionImage) : [],
    options,
    match,
    answer: question.answer,
    answerImages: question.answerImages,
    explanation: question.explanation,
    explanationImages: question.explanationImages,
  };
}

/** The group's shared passage (text + shared figure), built from a member row; null when it has neither. */
export function catalogPassageToView(question: CatalogQuestion): PassageViewModel | null {
  const text = question.passage ?? '';
  const images = question.passageImage ? [question.passageImage] : [];
  if (!text.trim() && images.length === 0) return null;
  return { text, images };
}
