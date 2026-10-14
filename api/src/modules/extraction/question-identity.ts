/**
 * Normalize typography in a printed identifier without dropping its exercise prefix or sub-part.
 * `Q.` / `Question` are generic number markers; `A-3` and `B-3` remain different identities.
 */
export function normalizePrintedQuestionLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  let label = value.normalize('NFKC').trim().toUpperCase().replace(/[‐‑‒–—−]/g, '-');
  const wrapped = /^\((.*)\)$|^\[(.*)\]$/u.exec(label);
  if (wrapped) label = (wrapped[1] ?? wrapped[2] ?? label).trim();
  label = label.replace(/^QUESTION\s*[.:-]?\s*(?=\d)/u, '')
    .replace(/^Q\s*[.:-]?\s*(?=\d)/u, '')
    .replace(/[.:]\s*$/u, '')
    .trim();
  if (!label || !/\d/u.test(label)) return null;
  label = label.replace(/\s*([._:/()-])\s*/g, '$1').replace(/\s+/g, '-');
  const prefixed = /^([A-Z]+)[._:/-]?(\d+)(.*)$/u.exec(label);
  if (prefixed) return `${prefixed[1] ?? ''}-${(prefixed[2] ?? '').replace(/^0+(?=\d)/u, '')}${prefixed[3] ?? ''}`;
  const numeric = /^(\d+)(.*)$/u.exec(label);
  return numeric ? `${(numeric[1] ?? '').replace(/^0+(?=\d)/u, '')}${numeric[2] ?? ''}` : label;
}

/** Numeric compatibility key for an identity; full labels remain the authoritative matching key. */
export function questionNumberFromPrintedLabel(value: string | null | undefined): number | null {
  const label = normalizePrintedQuestionLabel(value);
  if (!label) return null;
  const digits = /^(?:[A-Z]+-)?(\d+)(?:[A-Z]|\([A-Z0-9]+\))?$/u.exec(label)?.[1];
  if (!digits) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) ? number : null;
}
