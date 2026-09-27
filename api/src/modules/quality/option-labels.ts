/**
 * Choice labels are source data, not a presentation convention. A paper can use A–E, 1–5, I–IV,
 * p/q/r, or another short marker, and an answer has to be checked against the labels that paper
 * actually printed. Keeping this logic here prevents the quality scanner, bulk fixes, and staging
 * writer from each inventing their own A–D fallback.
 */

/** Types whose answer is a choice label whenever the question has options. */
export const CHOICE_TYPES: ReadonlySet<string> = new Set([
  'single_correct',
  'multi_correct',
  'assertion_reason',
  'true_false',
  // A matrix with a printed answer-choice panel stores the selected panel label. A direct-response
  // matrix has no options, so callers naturally skip this validation for it.
  'matrix',
]);

/**
 * A leading printed option marker: "(A) body", "A) body", "(1) body", "III. body", or
 * "R1: body". The marker must be followed by punctuation, so ordinary option prose is not mistaken
 * for a label. Extraction limits labels to short alphanumeric tokens too; this wider limit keeps
 * legacy rows readable without turning a paragraph into a label.
 */
const LABEL_PREFIX = /^\s*(?:[([{]\s*)?([A-Za-z0-9][A-Za-z0-9_-]{0,31})\s*(?:[)\]}.:])\s*/;

/** A case-insensitive comparison key for a printed choice label. */
export function optionLabelKey(label: string): string {
  return label
    .trim()
    .replace(/^[\s([{"']+/, '')
    .replace(/[\s)\]}.:,;"']+$/, '')
    .toLocaleLowerCase();
}

/** The printed label an option starts with, preserving its source casing, or null when it has none. */
export function optionLabel(option: string): string | null {
  const label = LABEL_PREFIX.exec(option)?.[1];
  return label ? label.trim() : null;
}

/** The option text with its label stripped, trimmed — what staging stores as the option's `body`. */
export function optionBody(option: string): string {
  return option.replace(LABEL_PREFIX, '').trim();
}

/** Every option's printed label, or null when any one is unlabelled. */
export function labelsOf(options: readonly string[]): string[] | null {
  const labels = options.map(optionLabel);
  return labels.every((label): label is string => label !== null) ? labels : null;
}

/** Remove answer-key decorations while retaining labels such as `R1`, `III`, and `10`. */
function answerTerms(answer: string): string[] {
  return answer
    .trim()
    .replace(/^\s*(?:correct\s+)?answer\s*[:=-]?\s*/i, '')
    .replace(/\b(?:options?|and)\b/gi, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .split(/[\s,;/&+]+/)
    .map(optionLabelKey)
    .filter(Boolean);
}

/**
 * Split an answer into case-insensitive choice-label keys. When `knownLabels` is supplied, an exact
 * multi-character label wins before compact multi-correct notation is expanded: `II` stays the Roman
 * label `II`, while `AC` becomes A+C only when the actual labels are one-character A and C.
 */
export function answerLabels(answer: string, knownLabels: readonly string[] = []): string[] {
  const known = new Map<string, string>();
  for (const label of knownLabels) {
    const key = optionLabelKey(label);
    if (key) known.set(key, key);
  }

  const raw = optionLabelKey(answer.replace(/^\s*(?:correct\s+)?answer\s*[:=-]?\s*/i, ''));
  if (raw && known.has(raw)) return [raw];

  const terms = answerTerms(answer);
  if (terms.length === 0) return [];
  const values: string[] = [];
  const oneCharacterKnown = known.size > 0 && [...known.keys()].every((label) => label.length === 1);
  for (const term of terms) {
    if (known.size === 0 || known.has(term)) {
      values.push(term);
      continue;
    }
    // Compact multi-correct notation is only unambiguous for an alphabet of one-character labels.
    // In particular, never split a numeric or Roman label such as `10` or `III` into characters.
    if (oneCharacterKnown && /^[a-z]{2,}$/.test(term) && Array.from(term).every((part) => known.has(part))) {
      values.push(...Array.from(term));
      continue;
    }
    // Keep an unknown token so callers can correctly report that the answer does not name an option.
    values.push(term);
  }
  return [...new Set(values)];
}

/** A direct `True`/`False` answer maps to a conventional labelled true/false option. */
function trueFalseOptionKey(answer: string, options: readonly string[]): string | null {
  const value = optionLabelKey(answer.replace(/^\s*(?:correct\s+)?answer\s*[:=-]?\s*/i, ''));
  if (value !== 'true' && value !== 'false') return null;
  const match = options.find((option) => {
    const body = optionBody(option).trim();
    return new RegExp(`^${value}\\b`, 'i').test(body);
  });
  const label = match ? optionLabel(match) : null;
  return label ? optionLabelKey(label) : null;
}

/**
 * Resolve an answer against a question's real options. Besides ordinary labels, this understands the
 * human-readable `True` / `False` answer stored for a conventional A/B true-false question. Matrix
 * mappings intentionally resolve to no choice labels: a direct-response matrix does not mark options.
 */
export function answerOptionLabels(answer: string, options: readonly string[]): string[] {
  const labels = labelsOf(options);
  if (!labels) return answerLabels(answer);
  const booleanLabel = trueFalseOptionKey(answer, options);
  if (booleanLabel) return [booleanLabel];
  return answerLabels(answer, labels);
}

/**
 * Map a legacy positional answer (`3`, `A`, or `A,C`) onto the supplied printed labels. Returns null
 * unless every term is an unambiguous position alias and none is already a real printed label.
 */
export function answerInOptionLabels(answer: string, labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const known = new Set(labels.map(optionLabelKey));
  const current = answerLabels(answer, labels);
  if (current.length > 0 && current.every((label) => known.has(label))) return null;

  const aliases = answerTerms(answer);
  if (aliases.length === 0) return null;
  const mapped: string[] = [];
  for (const alias of aliases) {
    const pieces = /^[a-z]{2,}$/.test(alias) ? Array.from(alias) : [alias];
    for (const piece of pieces) {
      let index: number | null = null;
      if (/^\d+$/.test(piece)) index = Number(piece) - 1;
      else if (/^[a-z]$/.test(piece)) index = piece.charCodeAt(0) - 'a'.charCodeAt(0);
      if (index === null || !Number.isSafeInteger(index) || index < 0 || index >= labels.length) return null;
      mapped.push(labels[index] ?? '');
    }
  }
  const result = [...new Set(mapped.filter(Boolean))];
  return result.length > 0 ? result.join(', ') : null;
}
