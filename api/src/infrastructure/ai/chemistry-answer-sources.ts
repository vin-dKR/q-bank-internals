import type { ChemistryExtraction, Document } from '@ingest/contracts';
import { z } from 'zod';
import { normalizePrintedQuestionLabel, type AnswerEntry, type AnswerSheet, type PageImage, type SourceBox, type SourceQuestionAnchor } from '../../modules/extraction/index.js';
import { enumerateSmilesCandidates, validateSmilesGraph } from './chemistry-audit.js';

const SourceBoxSchema = z.tuple([
  z.number().int().min(0).max(1000), z.number().int().min(0).max(1000),
  z.number().int().min(0).max(1000), z.number().int().min(0).max(1000),
]).refine(([left, top, right, bottom]) => left < right && top < bottom);

export const CHEMISTRY_ANSWER_SOURCE_RULE = 'CHEMISTRY SOURCE OWNERSHIP: For every answer/solution entry that contains a drawn molecule or reaction, also return source_bbox: [left, top, right, bottom] for its COMPLETE printed numbered entry in source-page coordinates 0–1000. Set answer_visual_kind and explanation_visual_kind separately to molecule, reaction, figure, or none, including a genuinely unreadable diagram that has no SMILES candidate. Include its printed identity, full answer and all working, and stop before the next numbered entry. When it continues across columns, return source_regions as those complete physical rectangles in reading order, and source_bbox as the first rectangle. Never include a neighboring numbered entry or invent a region for missing source content. Keep source_regions empty for an ordinary single block.';

export function parsedAnswerVisualKinds(value: unknown): AnswerEntry['sourceVisualKinds'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as { answer_visual_kind?: unknown; explanation_visual_kind?: unknown };
  const kinds: NonNullable<AnswerEntry['sourceVisualKinds']> = {};
  for (const [field, kind] of [['answer', record.answer_visual_kind], ['explanation', record.explanation_visual_kind]] as const) {
    if (kind === 'molecule' || kind === 'reaction' || kind === 'figure') kinds[field] = kind;
  }
  return Object.keys(kinds).length ? kinds : undefined;
}

export function parsedAnswerSourceRegions(value: unknown): SourceBox[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as { source_bbox?: unknown; source_regions?: unknown };
  const supplied = Array.isArray(record.source_regions) && record.source_regions.length > 0
    ? record.source_regions : record.source_bbox === undefined ? [] : [record.source_bbox];
  if (supplied.length > 8) return [];
  const boxes = supplied.map((box) => SourceBoxSchema.safeParse(box));
  if (boxes.some((box) => !box.success)) return [];
  return boxes.flatMap((box): SourceBox[] => box.success ? [[box.data[0] / 1000, box.data[1] / 1000, box.data[2] / 1000, box.data[3] / 1000]] : []);
}

function contains(outer: SourceBox, inner: SourceBox): boolean {
  return inner[0] >= outer[0] - .002 && inner[1] >= outer[1] - .002 && inner[2] <= outer[2] + .002 && inner[3] <= outer[3] + .002;
}

function overlap(first: SourceBox, second: SourceBox): boolean {
  const width = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
  const height = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
  if (width <= .002 || height <= .002) return false;
  const area = Math.min((first[2] - first[0]) * (first[3] - first[1]), (second[2] - second[0]) * (second[3] - second[1]));
  return width * height >= area * .05;
}

function sectionKey(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function nativeOwner(label: string, section: string | null, anchors: SourceQuestionAnchor[]): SourceQuestionAnchor | null {
  const exact = anchors.filter((anchor) => normalizePrintedQuestionLabel(anchor.printedLabel) === label);
  const scoped = exact.filter((anchor) => sectionKey(anchor.sourceSection) === sectionKey(section));
  return scoped.length === 1 ? scoped[0] ?? null : exact.length === 1 ? exact[0] ?? null : null;
}

function ownedSourceRegions(label: string, section: string | null, entry: AnswerEntry, page: PageImage): SourceBox[] {
  const anchors = page.layout?.questions ?? [];
  const owner = nativeOwner(label, section, anchors);
  const supplied = entry.sourceRegions ?? [];
  // A native numbered block is the stable authority for ordinary single-column entries. Explicit
  // continuation parts must remain separate to avoid turning a column-spanning union into a crop.
  const regions = supplied.length > 1 ? supplied : owner ? [owner.bbox] : supplied;
  if (owner && supplied.length < 2 && page.layout?.limitations.includes('column_continuations_require_multi_region_review')) {
    const laterColumn = anchors.some((anchor) => anchor.anchorBox[0] > owner.anchorBox[0] + .1);
    const boundedBelow = anchors.some((anchor) => Math.abs(anchor.anchorBox[0] - owner.anchorBox[0]) <= .08 && anchor.anchorBox[1] > owner.anchorBox[1]);
    if (laterColumn && !boundedBelow) return [];
  }
  if (regions.length === 0 || new Set(regions.map((box) => box.join(':'))).size !== regions.length) return [];
  const first = regions[0];
  if (owner && (!first || !contains(first, owner.anchorBox))) return [];
  const contentBox = page.layout?.contentBox;
  if (contentBox && regions.some((box) => !contains(contentBox, box))) return [];
  if (anchors.some((anchor) => anchor !== owner && regions.some((box) => contains(box, anchor.anchorBox)))) return [];
  if (regions.some((box, index) => regions.slice(index + 1).some((other) => overlap(box, other)))) return [];
  return regions;
}

/** Carry source ownership into answer reconciliation before candidate diagrams can be rendered. */
export async function attachChemistryAnswerSources(sheets: AnswerSheet[], document: Document, page: PageImage): Promise<AnswerSheet[]> {
  const claims = sheets.flatMap((sheet) => Object.entries(sheet.entries).flatMap(([printedLabel, entry]) => {
    const label = normalizePrintedQuestionLabel(printedLabel);
    if (!label || (enumerateSmilesCandidates({ answer: entry.answer, explanation: entry.explanation }).length === 0 && !Object.keys(entry.sourceVisualKinds ?? {}).length && !Object.values(entry.sourceMoleculeCounts ?? {}).some((count) => count !== undefined && count > 0))) return [];
    return [{ key: `${sectionKey(sheet.sectionName)}:${label}`, regions: ownedSourceRegions(label, sheet.sectionName, entry, page) }];
  }));
  const enriched: AnswerSheet[] = [];
  for (const sheet of sheets) {
    const entries: AnswerSheet['entries'] = {};
    for (const [printedLabel, entry] of Object.entries(sheet.entries)) {
      const fields = ([['answer', entry.answer], ['explanation', entry.explanation]] as const).flatMap(([field, text]) => {
        const candidates = enumerateSmilesCandidates({ stem: text });
        const kind = entry.sourceVisualKinds?.[field];
        const moleculeCount = entry.sourceMoleculeCounts?.[field];
        return candidates.length > 0 || kind || (moleculeCount ?? 0) > 0 ? [{ field, candidates, kind: kind ?? 'reaction', moleculeCount }] : [];
      });
      if (fields.length === 0) { entries[printedLabel] = entry; continue; }
      const label = normalizePrintedQuestionLabel(printedLabel);
      const regions = label ? ownedSourceRegions(label, sheet.sectionName, entry, page) : [];
      const key = `${sectionKey(sheet.sectionName)}:${label ?? printedLabel}`;
      const conflicting = claims.some((claim) => claim.key !== key && claim.regions.some((first) => regions.some((second) => overlap(first, second))));
      if (!regions.length || conflicting) {
        entries[printedLabel] = { ...entry, unresolvedSourceFields: [...new Set([...(entry.unresolvedSourceFields ?? []), ...fields.map((field) => field.field)])], chemistryIssues: [...(entry.chemistryIssues ?? []), `The ${fields.map((field) => field.field).join(' and ')} molecular source for ${printedLabel} could not be assigned to a complete numbered source block.`] };
        continue;
      }
      const visuals: ChemistryExtraction['visuals'] = [];
      for (const { field, candidates, kind, moleculeCount } of fields) {
        const validation = await Promise.all(candidates.map((candidate) => validateSmilesGraph(candidate.smiles)));
        const boxes = regions.map(([left, top, right, bottom]): [number, number, number, number] => [left, top, right - left, bottom - top]);
        const bbox = boxes[0];
        if (!bbox) continue;
        visuals.push({ id: `${field}:${document.id}:${String(page.pageNumber)}:${key}`, field, optionLabel: null, kind, bbox, ...(boxes.length > 1 ? { regions: boxes } : {}), candidateSmiles: candidates.map((candidate) => candidate.smiles), graphValid: candidates.length ? validation.every((result) => result.ok) : null, ...(moleculeCount !== undefined ? { moleculeCount } : {}), cropUrl: null, sourceDocumentId: document.id, sourcePage: page.pageNumber });
      }
      entries[printedLabel] = { ...entry, chemistryVisuals: visuals };
    }
    enriched.push({ ...sheet, entries });
  }
  return enriched;
}
