import {
  DEFAULT_STRUCTURE_HIERARCHY,
  type StructureCropRole,
  type StructureHierarchyLevel,
} from '@ingest/contracts';

/** Use the same labels and colours in selection controls, PDF boxes and OCR review. */
const DEFAULT_PRESENTATION = {
  combined: { label: 'Combined', color: '#6366f1' },
  section: { label: 'Section', color: '#2563eb' },
  part: { label: 'Part', color: '#c2410c' },
  topic: { label: 'Topic', color: '#047857' },
};

const EXTRA_COLORS = [
  '#7c3aed',
  '#be185d',
  '#0e7490',
  '#a16207',
  '#475569',
  '#9f1239',
  '#166534',
  '#075985',
  '#6b21a8',
  '#9a3412',
  '#86198f',
  '#115e59',
  '#3730a3',
  '#1e3a8a',
  '#7f1d1d',
  '#713f12',
];
export function structureCropRolePresentation(
  role: StructureCropRole,
  hierarchy: readonly StructureHierarchyLevel[] = DEFAULT_STRUCTURE_HIERARCHY,
): { label: string; color: string } {
  if (role === 'combined') return DEFAULT_PRESENTATION.combined;
  const level = hierarchy.find((item) => item.id === role);
  const base = Object.entries(DEFAULT_PRESENTATION).find(([id]) => id === role)?.[1];
  if (base) return { label: level?.name ?? `Removed level (${role})`, color: base.color };
  if (!level) return { label: `Removed level (${role})`, color: '#475569' };
  const customIds = hierarchy
    .map((level) => level.id)
    .filter((id) => !Object.hasOwn(DEFAULT_PRESENTATION, id))
    .sort();
  const usedColors = new Set<number>();
  let colorIndex = 0;
  for (const id of customIds) {
    colorIndex =
      Array.from(id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % EXTRA_COLORS.length;
    while (usedColors.has(colorIndex)) colorIndex = (colorIndex + 1) % EXTRA_COLORS.length;
    usedColors.add(colorIndex);
    if (id === role) break;
  }
  return {
    label: level.name,
    color: EXTRA_COLORS[colorIndex] ?? '#475569',
  };
}
