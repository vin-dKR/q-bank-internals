/**
 * Parse an operator-typed page range like `"3-5, 8"` into the explicit 1-based page numbers it names
 * (`[3, 4, 5, 8]`), deduplicated and sorted ascending. Returns `null` for anything malformed or out
 * of bounds — an empty string, a non-number, a reversed span, a zero/negative page, or a page above
 * `maxPage` — so a caller can reject the input outright rather than bind a wrong slice.
 */
export function parsePageRange(input: string, maxPage: number): number[] | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const pages = new Set<number>();
  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (part.length === 0) return null;

    const dash = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (dash) {
      const from = Number(dash[1]);
      const to = Number(dash[2]);
      if (from < 1 || to < from || to > maxPage) return null;
      for (let page = from; page <= to; page += 1) pages.add(page);
      continue;
    }

    if (!/^\d+$/.test(part)) return null;
    const page = Number(part);
    if (page < 1 || page > maxPage) return null;
    pages.add(page);
  }

  return [...pages].sort((a, b) => a - b);
}

/**
 * The compact range expression for a set of pages — the inverse of {@link parsePageRange} used to
 * prefill the edit input from a binding's provenance. `"page 3"` / `"pages 3–5"` (either dash) become
 * `"3"` / `"3-5"`; a scattered `"N pages"` label has no faithful range, so it yields `""`.
 */
export function pageRangeFromLabel(label: string): string {
  const single = label.match(/^page\s+(\d+)$/i);
  if (single) return single[1] ?? '';
  const span = label.match(/^pages\s+(\d+)\s*[–-]\s*(\d+)$/i);
  if (span) return `${span[1] ?? ''}-${span[2] ?? ''}`;
  return '';
}
