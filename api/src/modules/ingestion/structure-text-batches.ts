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
      (item.role ?? 'combined') === (crop.role ?? 'combined') &&
      item.contextKey === contextKey &&
      item.items.every(
        (heading) =>
          (!heading.section || Boolean(heading.section.label)) &&
          (!heading.part || Boolean(heading.part.label)),
      ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Each request still reads one crop, even when independent typed requests run together. */
export function structureTextBatches(crops: readonly StructureTextCrop[]): StructureTextCrop[][] {
  return crops.filter((crop) => crop.text.trim()).map((crop) => [crop]);
}

export const STRUCTURE_TYPED_CROP_CONCURRENCY = 3;

/** Combined crops are barriers: they need all preceding observations before being requested. */
export function structureRequestGroups(crops: readonly StructureTextCrop[]): StructureTextCrop[][] {
  const groups: StructureTextCrop[][] = [];
  let typed: StructureTextCrop[] = [];
  const flush = (): void => {
    if (typed.length) groups.push(typed);
    typed = [];
  };
  for (const crop of crops) {
    if ((crop.role ?? 'combined') === 'combined') {
      flush();
      groups.push([crop]);
    } else {
      typed.push(crop);
      if (typed.length === STRUCTURE_TYPED_CROP_CONCURRENCY) flush();
    }
  }
  flush();
  return groups;
}
