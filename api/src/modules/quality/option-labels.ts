/**
 * The bank's answer-labelling convention: a question that offers CHOICES labels them `(A) (B) (C) (D)`,
 * and its answer names those letters. Numbers stay where they belong — an integer question's answer, a
 * numeric value inside an option's text — but they are never used to identify an option.
 *
 * Legacy rows break this both ways (options numbered `(1)–(4)`, or an answer naming a label its options do
 * not use), because each source PDF printed it its own way. This module is the one place that knows the
 * convention, so the checker and the fix agree on it.
 */

/** Types whose ANSWER must name one of the question's option labels. */
export const CHOICE_TYPES: ReadonlySet<string> = new Set(['single_correct', 'multi_correct', 'assertion_reason']);

/**
 * Types whose options are choices to pick from, so they carry letter labels. A comprehension row offers
 * choices like any MCQ (its passage is shared, its options are its own), but its ANSWER is not always a
 * label, which is why it is not in {@link CHOICE_TYPES}.
 */
export const LETTER_LABEL_TYPES: ReadonlySet<string> = new Set([...CHOICE_TYPES, 'comprehension']);

/** The leading label of a bank option string: "(A) body", "A) body", "(1) body", "iii. body". */
const LABEL_PREFIX = /^\s*\(?\s*([A-Za-z]|[ivx]{1,4}|\d{1,2})\s*[).]\s*/;

/** The lowercase label an option string starts with ("(A) body" → "a"), or null when it has none. */
export function optionLabel(option: string): string | null {
  return LABEL_PREFIX.exec(option)?.[1]?.toLowerCase() ?? null;
}

/** The option text with its label stripped, trimmed — what staging stores as the option's `body`. */
export function optionBody(option: string): string {
  return option.replace(LABEL_PREFIX, '').trim();
}

/** Split an answer into lowercase option labels: "A", "(A)", "A, C", "AC", "a and c" → ['a','c']. */
export function answerLabels(answer: string): string[] {
  const parts = answer
    .trim()
    .toLowerCase()
    .replace(/option|and|[().]/g, ' ')
    .split(/[\s,;/&]+/)
    .filter(Boolean);
  const [only] = parts;
  if (parts.length === 1 && only !== undefined && /^[a-e]{2,5}$/.test(only)) return only.match(/[a-e]/g) ?? [];
  return parts;
}

/** The letter for a position: 0 → "A". */
export function letterAt(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

/** Every option's label, or null when any of them is unlabelled (nothing to convert or check). */
export function labelsOf(options: readonly string[]): string[] | null {
  const labels = options.map(optionLabel);
  return labels.every((label): label is string => label !== null) ? labels : null;
}

/** True when every option is labelled with a number — the shape this convention replaces. */
export function hasNumberedLabels(options: readonly string[]): boolean {
  const labels = labelsOf(options);
  return labels !== null && labels.length > 0 && labels.every((label) => /^\d+$/.test(label));
}

/** Rewrite each option to `(A) body`, keeping its text and order. */
export function relabelToLetters(options: readonly string[]): string[] {
  return options.map((option, index) => `(${letterAt(index)}) ${optionBody(option)}`);
}

/**
 * The answer rewritten in letters, given how many options there are: "3" → "C", "2, 3" → "B, C". Null when
 * it is not a list of positions (free text, a matrix key, or a number past the last option), which is left
 * for a person — this never guesses which option was meant.
 */
export function answerInLetters(answer: string, optionCount: number): string | null {
  const labels = answerLabels(answer);
  if (labels.length === 0) return null;
  const letters = labels.map((label) => {
    if (/^[a-z]$/.test(label)) {
      const index = label.charCodeAt(0) - 'a'.charCodeAt(0);
      return index < optionCount ? label.toUpperCase() : null;
    }
    if (!/^\d+$/.test(label)) return null;
    const index = Number(label) - 1;
    return index >= 0 && index < optionCount ? letterAt(index) : null;
  });
  return letters.every((letter): letter is string => letter !== null) ? letters.join(', ') : null;
}
