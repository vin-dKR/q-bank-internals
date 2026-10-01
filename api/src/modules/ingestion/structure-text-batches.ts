import type {
  StructureTextCrop,
  StructureExtractedCrop,
  StructureDetectionContext,
  StructureRule,
} from '@ingest/contracts';

export function structureCropContextKey(
  context: StructureDetectionContext,
  rule: StructureRule | null = null,
): string {
  return JSON.stringify({ context, rule });
}

export function reusableStructureCrop(
  crop: StructureTextCrop,
  saved: readonly StructureExtractedCrop[] = [],
  contextKey: string,
): StructureExtractedCrop | undefined {
  const matches = saved.filter(
    (item) =>
      item.cropId === crop.id &&
      item.text === crop.text &&
      item.contextKey === contextKey &&
      item.items.every(
        (heading) =>
          (!heading.section || Boolean(heading.section.label)) &&
          (!heading.part || Boolean(heading.part.label)),
      ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** One current crop per request; code supplies the preceding hierarchy to the next request. */
export function structureTextBatches(crops: readonly StructureTextCrop[]): StructureTextCrop[][] {
  return crops.filter((crop) => crop.text.trim()).map((crop) => [crop]);
}
