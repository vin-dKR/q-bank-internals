/**
 * Choice markers belong to the source convention. Adding a replacement choice must continue the
 * source sequence rather than silently changing numbered or Roman labels into A through Z.
 */

type LabelledChoice = { label: string };

/** A case-insensitive identity key for a printed choice marker. */
export function optionLabelKey(value: string): string {
  return value
    .trim()
    .replace(/^[\s([{]+/, '')
    .replace(/[\s)\]}.:]+$/, '')
    .toLocaleUpperCase();
}

function token(value: string): string {
  return value
    .trim()
    .replace(/^[\s([{]+/, '')
    .replace(/[\s)\]}.:,;]+$/, '')
    .trim();
}

function firstMissing(start: number, taken: ReadonlySet<number>): number | null {
  let candidate = start;
  while (taken.has(candidate)) {
    if (candidate >= Number.MAX_SAFE_INTEGER) return null;
    candidate += 1;
  }
  return candidate;
}

function numericLabel(labels: readonly string[]): string | null {
  if (labels.length === 0 || !labels.every((label) => /^\d+$/.test(label))) return null;
  const values = labels.map(Number);
  if (!values.every(Number.isSafeInteger)) return null;
  const next = firstMissing(values[0] ?? 1, new Set(values));
  if (next === null) return null;
  const first = labels[0] ?? '';
  const padded =
    /^0\d+$/.test(first) &&
    labels.every((label) => label.length === first.length && /^0\d+$/.test(label));
  return padded ? String(next).padStart(first.length, '0') : String(next);
}

type PrefixedNumber = { prefix: string; value: number; width: number };

function prefixedNumber(label: string): PrefixedNumber | null {
  const parts = /^(.+?)(\d+)$/.exec(label);
  if (!parts?.[1] || !parts[2]) return null;
  const value = Number(parts[2]);
  return Number.isSafeInteger(value) ? { prefix: parts[1], value, width: parts[2].length } : null;
}

function prefixedNumericLabel(labels: readonly string[]): string | null {
  const values = labels.map(prefixedNumber);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  const first = values[0];
  if (!first) return null;
  const parsed = values.filter((value): value is PrefixedNumber => value !== null);
  if (!parsed.every((value) => value.prefix.toLocaleUpperCase() === first.prefix.toLocaleUpperCase()))
    return null;
  const next = firstMissing(first.value, new Set(parsed.map((value) => value.value)));
  if (next === null) return null;
  const padded =
    first.width > 1 &&
    parsed.every((value) => value.width === first.width);
  return first.prefix + (padded ? String(next).padStart(first.width, '0') : String(next));
}

const ROMAN_PARTS: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function romanText(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3999) return null;
  let remaining = value;
  let result = '';
  for (const [amount, symbol] of ROMAN_PARTS) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

function romanValue(label: string): number | null {
  const normalized = label.toLocaleUpperCase();
  if (!/^[IVXLCDM]+$/.test(normalized)) return null;
  let total = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = ROMAN_PARTS.find(([, symbol]) => symbol === normalized[index])?.[0];
    const after = ROMAN_PARTS.find(([, symbol]) => symbol === normalized[index + 1])?.[0] ?? 0;
    if (!current) return null;
    total += current < after ? -current : current;
  }
  return romanText(total) === normalized ? total : null;
}

function romanLabel(labels: readonly string[]): string | null {
  const values = labels.map(romanValue);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  // C, D, and M alone can equally be alphabetic markers. I/V/X or a compound marker proves Roman.
  if (!labels.some((label) => label.length > 1 || /^[IVX]$/i.test(label))) return null;
  const first = values[0];
  if (first === null || first === undefined) return null;
  const next = firstMissing(first, new Set(values.filter((value): value is number => value !== null)));
  const nextRoman = next === null ? null : romanText(next);
  if (!nextRoman) return null;
  return labels[0] === labels[0]?.toLocaleLowerCase() ? nextRoman.toLocaleLowerCase() : nextRoman;
}

function alphabetValue(label: string): number | null {
  if (!/^[A-Za-z]{1,3}$/.test(label)) return null;
  let value = 0;
  for (const character of label.toLocaleUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return Number.isSafeInteger(value) ? value : null;
}

function alphabetText(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  let remaining = value;
  let result = '';
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(65 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function alphabeticLabel(labels: readonly string[]): string | null {
  const values = labels.map(alphabetValue);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  const numbers = values.filter((value): value is number => value !== null);
  const first = numbers[0];
  if (first === undefined || Math.max(...numbers) - first > Math.max(26, numbers.length * 12))
    return null;
  const next = firstMissing(first, new Set(numbers));
  const result = next === null ? null : alphabetText(next);
  if (!result) return null;
  return labels[0] === labels[0]?.toLocaleLowerCase() ? result.toLocaleLowerCase() : result;
}

function fallbackLabel(taken: ReadonlySet<string>): string {
  for (let value = 1; value <= taken.size + 1; value += 1) {
    const label = alphabetText(value);
    if (label && !taken.has(optionLabelKey(label))) return label;
  }
  return 'Option';
}

/**
 * Reuses the first missing marker at or after the first displayed marker, so removing 4 from
 * 1, 2, 3, 4 then adding a choice restores 4. Unknown, non-sequential markers retain the historical
 * alphabetic fallback because no automatic next marker can be inferred safely.
 */
export function nextOptionLabel(options: readonly LabelledChoice[]): string {
  const labels = options.map((option) => token(option.label)).filter(Boolean);
  const taken = new Set(labels.map(optionLabelKey));
  return (
    numericLabel(labels) ??
    prefixedNumericLabel(labels) ??
    romanLabel(labels) ??
    alphabeticLabel(labels) ??
    fallbackLabel(taken)
  );
}
