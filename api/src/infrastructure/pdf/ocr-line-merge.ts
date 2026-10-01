import type { OcrLine } from '../../modules/ingestion/index.js';

function sameRegion(a: OcrLine['box'], b: OcrLine['box']): boolean {
  const vertical = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const horizontal = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return (
    vertical / Math.max(1, Math.min(a.bottom - a.top, b.bottom - b.top)) >= 0.6 &&
    horizontal / Math.max(1, Math.min(a.right - a.left, b.right - b.left)) >= 0.6
  );
}

function textKey(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Merge by position so repeated headings in different regions remain separate. */
export function mergeOcrLines(
  automatic: readonly OcrLine[],
  sparse: readonly OcrLine[],
): OcrLine[] {
  const lines = automatic
    .filter((line) => line.text.trim())
    .map((line) => ({ ...line, box: { ...line.box }, warnings: [...(line.warnings ?? [])] }));
  for (const line of sparse) {
    if (!line.text.trim()) continue;
    const match = lines.find((existing) => sameRegion(existing.box, line.box));
    if (!match) {
      lines.push({
        ...line,
        box: { ...line.box },
        warnings: [
          ...(line.warnings ?? []),
          `An additional OCR pass recovered "${line.text}". Verify it against the crop.`,
        ],
      });
    } else if (textKey(match.text) === textKey(line.text)) {
      match.confidence = Math.max(match.confidence, line.confidence);
    } else {
      match.warnings.push(
        `OCR readings disagree: "${match.text}" / "${line.text}". Verify this line before saving.`,
      );
    }
  }
  return lines.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
}
