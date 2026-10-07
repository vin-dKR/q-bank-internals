import type { DetectedStructureNode } from './structure-detection.schema.js';

/** Decorative OCR glyphs may precede a real marker; never remove words from an unmarked name. */
export function headingWithoutOcrNoise(label: string): string {
  return label
    .trim()
    .replace(/^(?:B[|Il1]|[|Il1!;:.,*#_\-–—\s])+(?=(?:exercise|part|section|topic)\b)/iu, '');
}

/** Display formatting may remove markers, but it cannot supply a topic name absent from the PDF. */
export function isPrintedTopicLabel(printed: string, label: string): boolean {
  const normalize = (value: string): string =>
    value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
  return !label.trim() || normalize(printed).includes(normalize(label));
}

/** Keep only the printed Part identifier; descriptions belong outside its label. */
export function partNameFromHeading(label: string): string {
  const heading = headingWithoutOcrNoise(label);
  const identifier = /^(?:part\s*[-:.–—]?\s*)?\(?([0-9]+|[ivxlcdm]+|[a-z])\)?(?=\s|[:.\-–—]|$)/i;
  return identifier.exec(heading)?.[1] ?? heading.replace(/^part\s*[:.\-–—]?\s*/i, '').trim();
}

/** Remove Section/Topic markers without changing the printed name that follows them. */
export function topicNameFromHeading(label: string): string {
  const heading = headingWithoutOcrNoise(label);
  const parenthesized = /^(?:section|topic)\s*[-:.–—]?\s*\([^()]*\)\s*[:.\-–—]?\s*([\s\S]*)$/i;
  const marker = '(?:[a-z]\\d*|\\d+|[ivxlcdm]+)';
  const numbered = new RegExp(
    `^(?:section|topic)\\s*[-–—]?\\s*${marker}(?:\\s*[:.\\-–—]\\s*|\\s+)([\\s\\S]*)$`,
    'i',
  );
  const unnumbered = /^(?:section|topic)\s*[:.\-–—]\s*([\s\S]*)$/i;
  const unnamed = new RegExp(`^(?:section|topic)(?:\\s*[-–—]?\\s*${marker})?\\s*$`, 'i');
  return (
    parenthesized.exec(heading)?.[1] ??
    numbered.exec(heading)?.[1] ??
    unnumbered.exec(heading)?.[1] ??
    (unnamed.test(heading) ? '' : heading)
  ).trim();
}

/** Detection, config import and JSON validation use the same label rules. */
export function structureLabelFromHeading(
  level: DetectedStructureNode['level'],
  label: string,
): string {
  if (level === 'part') return partNameFromHeading(label);
  if (level === 'topic') return topicNameFromHeading(label);
  return headingWithoutOcrNoise(label);
}
