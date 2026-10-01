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
 * The compact range expression for explicit pages — the inverse of {@link parsePageRange} used to
 * prefill the edit input from a binding's page numbers. `[3, 4, 5, 8]` becomes `"3-5, 8"`.
 */
export function pageRangeText(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) j += 1;
    const from = sorted[i];
    const to = sorted[j];
    if (from !== undefined && to !== undefined) {
      parts.push(from === to ? String(from) : `${String(from)}-${String(to)}`);
    }
    i = j + 1;
  }
  return parts.join(', ');
}

/** Display every attached page, including gaps, so a page count cannot be mistaken for a page number. */
export function pageRangeLabel(pages: number[]): string {
  const range = pageRangeText(pages);
  if (range.length === 0) return 'no pages';
  const plural = range.includes('-') || range.includes(',');
  return `${plural ? 'pages' : 'page'} ${range.replace(/-/g, '–')}`;
}
