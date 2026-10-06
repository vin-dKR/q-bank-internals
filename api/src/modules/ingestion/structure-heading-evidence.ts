import {
  headingWithoutOcrNoise,
  topicNameFromHeading,
  type StructureHeadingLevel,
  type StructureRule,
  type StructureCropRole,
  structureHierarchy,
} from '@ingest/contracts';

export type StructureHeadingCandidates = Record<StructureHeadingLevel, string[]>;

/** Whitespace and PDF compatibility glyphs may differ; words and punctuation must still match. */
export function printedHeadingKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

export function isExamYearHeading(value: string): boolean {
  const name = topicNameFromHeading(value.normalize('NFKC')).trim();
  return /^(?:re[-\s]*)?(?:neet(?:[-\s]*(?:ug|pg|i{1,2}))?|aipmt|aiims|jee(?:[-\s]*(?:main|advanced))?|iit[-\s]*jee|bitsat)\b.*\b(?:19|20)\d{2}\b/iu.test(
    name,
  );
}

function exampleMatches(heading: string, example: string): boolean {
  if (!example.trim()) return false;
  // Match the provider's heading marker, never the sample's topic or number.
  const prefix =
    example
      .split(/[-:(]/u)[0]
      ?.trim()
      .replace(/\s+(?:\d+|[ivxlcdm]+|[a-z])$/iu, '') ?? '';
  return (
    Boolean(prefix) &&
    (heading.toLowerCase() === prefix.toLowerCase() ||
      heading.toLowerCase().startsWith(`${prefix.toLowerCase()} `) ||
      heading.toLowerCase().startsWith(`${prefix.toLowerCase()}-`) ||
      heading.toLowerCase().startsWith(`${prefix.toLowerCase()}:`) ||
      heading.toLowerCase().startsWith(`${prefix.toLowerCase()}(`))
  );
}

function isCropHeadingLine(heading: string): boolean {
  return (
    !isExamYearHeading(heading) &&
    !/^(?:[\s*#|!]+|\d+\s+)*(?:answers?|solutions?|questions?|answer\s+key|marked\s+questions?|jee\s*\(|iit[-\s]*jee)\b/iu.test(
      heading,
    ) &&
    !/^(?:\(?[a-z]\d*\)?[-.\s]*)?\d+\s*[-.):]/iu.test(heading)
  );
}

/** The model can select only structural heading candidates read from this PDF page. */
export function structureHeadingCandidates(
  lines: readonly string[],
  rule: StructureRule | null = null,
  reviewedCrop = false,
  role: StructureCropRole = 'combined',
): StructureHeadingCandidates {
  const hierarchy = structureHierarchy(rule);
  const candidates: StructureHeadingCandidates = Object.fromEntries(
    hierarchy.map((level) => [level.id, []]),
  );
  const markers: Record<StructureHeadingLevel, RegExp> = {
    section: /^(?:exercise\b|section\s*[-:]?\s*(?:\d+|[ivxlcdm]+)\b)/iu,
    part: /^part\b/iu,
    topic: /^(?:section|topic)\b/iu,
  };
  for (const text of lines) {
    const heading = text.trim();
    if (!heading || heading.length > 500) continue;
    const markerText = headingWithoutOcrNoise(heading);
    if (role !== 'combined') {
      // The operator supplies the hierarchy role; evidence must still be present in this crop.
      if (candidates[role] && isCropHeadingLine(heading) && !candidates[role].includes(heading))
        candidates[role].push(heading);
      continue;
    }
    for (const entry of hierarchy) {
      const level = entry.id;
      if (level === 'topic' && isExamYearHeading(heading)) continue;
      const unmarkedCropLine =
        level === 'topic' &&
        reviewedCrop &&
        !Object.values(markers).some((marker) => marker.test(markerText)) &&
        isCropHeadingLine(heading);
      if (
        !markers[level]?.test(markerText) &&
        !exampleMatches(markerText, entry.example) &&
        !unmarkedCropLine
      )
        continue;
      if (!candidates[level]?.includes(heading)) candidates[level]?.push(heading);
    }
  }
  return candidates;
}
