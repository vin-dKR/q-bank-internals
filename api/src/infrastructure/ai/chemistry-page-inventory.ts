import sharp from 'sharp';
import { z } from 'zod';
import { errors } from '../../shared/errors/error-catalog.js';
import type { SourceBox, SourcePageLayout } from '../../modules/extraction/index.js';
import { normalizePrintedQuestionLabel } from '../../modules/extraction/index.js';
import { composeNativeSourceCrops } from '../pdf/sharp-image-cropper.js';

const BoxSchema = z.tuple([
  z.number().int().min(0).max(1000), z.number().int().min(0).max(1000),
  z.number().int().min(0).max(1000), z.number().int().min(0).max(1000),
]);
const KindSchema = z.enum(['none', 'molecule', 'reaction', 'figure']);
const InventorySchema = z.object({
  page_role: z.enum(['questions', 'answers', 'solutions', 'mixed', 'empty']),
  question_regions: z.array(z.object({
    printed_label: z.string().nullable(),
    source_section: z.string().nullable(),
    bbox: BoxSchema,
    source_regions: z.array(BoxSchema).max(8).default([]),
    stem_bbox: BoxSchema.nullable(),
    stem_regions: z.array(BoxSchema).max(8).default([]),
    visual_kind: KindSchema,
    options: z.array(z.object({ label: z.string(), bbox: BoxSchema, visual_kind: KindSchema }).strict()),
  }).strict()),
}).strict();

export type ChemistryPageInventory = z.infer<typeof InventorySchema>;
export type ChemistryQuestionRegion = ChemistryPageInventory['question_regions'][number];
export type ChemistryBox = z.infer<typeof BoxSchema>;

const BOX_JSON = { type: 'array', items: { type: 'integer', minimum: 0, maximum: 1000 }, minItems: 4, maxItems: 4 };
const KIND_JSON = { type: 'string', enum: ['none', 'molecule', 'reaction', 'figure'] };

export const CHEMISTRY_INVENTORY_JSON_SCHEMA = {
  name: 'chemistry_source_inventory', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['page_role', 'question_regions'],
    properties: {
      page_role: { type: 'string', enum: ['questions', 'answers', 'solutions', 'mixed', 'empty'] },
      question_regions: { type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['printed_label', 'source_section', 'bbox', 'source_regions', 'stem_bbox', 'stem_regions', 'visual_kind', 'options'],
        properties: {
          printed_label: { type: ['string', 'null'] }, source_section: { type: ['string', 'null'] },
          bbox: BOX_JSON, source_regions: { type: 'array', items: BOX_JSON, maxItems: 8 },
          stem_bbox: { anyOf: [BOX_JSON, { type: 'null' }] }, stem_regions: { type: 'array', items: BOX_JSON, maxItems: 8 }, visual_kind: KIND_JSON,
          options: { type: 'array', items: {
            type: 'object', additionalProperties: false, required: ['label', 'bbox', 'visual_kind'],
            properties: { label: { type: 'string' }, bbox: BOX_JSON, visual_kind: KIND_JSON },
          } },
        },
      } },
    },
  },
};

export const CHEMISTRY_INVENTORY_PROMPT = `Inventory the VISIBLE exam page before transcribing it. Return the requested JSON, without solving chemistry or generating SMILES.
First classify page_role. An Answers/Answer Key page with numbered letters/values is answers, not questions. Worked numbered solutions under an Answers/Solutions heading are solutions, not new questions. A page that visibly prints genuine question prompts as well as inline answers is mixed. Headers and empty pages are empty. Do not convert a key entry such as "3. (B)" or a numbered worked result into a question.
For questions/mixed only, list EVERY genuine question in reading order, using the EXACT printed_label including section prefixes (A-1, B-3), or null only if absent. source_section is the printed exercise/part/subsection scope, never an inferred chapter/topic. Do not merge neighboring questions or split subparts. Do not invent missing content on a cut page.
All boxes use integer normalized coordinates [LEFT, TOP, RIGHT, BOTTOM] from 0 to 1000. bbox encloses ONE COMPLETE visible question, including its stem, reactions, tables and all options, but no neighboring question, footer or unrelated heading. stem_bbox encloses the complete stem INCLUDING its wording and all reaction schemes/conditions, but EXCLUDING the option panel; use null only if a separate stem is not visible. Include a little white space so bonds, charges and arrow labels are not clipped.
For a question that CONTINUES from the bottom of one column to the top of the next, source_regions contains the separate actual content rectangles IN READING ORDER; never use one large rectangle that captures neighboring questions. stem_regions contains its separate stem rectangles excluding choices. For an ordinary contiguous question use [] for these two arrays. bbox/stem_bbox are enclosing bounds only when multiple regions are used. A statement or options above the next numbered question may belong to the preceding column's final question: inspect that continuation explicitly. Preserve all such statements and choices under the original question label.
visual_kind describes the stem: reaction for any drawn arrow sequence with molecules/conditions, including cycles and unknown A/B/C products; molecule for drawn molecular bonds/rings; figure for other diagrams; none for text/formulas only. Count a Fischer/Haworth/chair or wedge/dash depiction as a molecule, even if recognition is difficult. A linear typeset formula alone is none.
For EVERY printed selectable option, preserve its actual label and complete content box and visual_kind. Include text options too. Each option box includes the entire option and label, not another option. Preserve source order/count, including incomplete choice panels. Do not assume four options. For answer/solution/empty-only pages return question_regions: [].`;

function validBox(box: ChemistryBox): boolean {
  return box[2] > box[0] && box[3] > box[1];
}

function enclosingBox(boxes: ChemistryBox[]): ChemistryBox {
  return [Math.min(...boxes.map((box) => box[0])), Math.min(...boxes.map((box) => box[1])), Math.max(...boxes.map((box) => box[2])), Math.max(...boxes.map((box) => box[3]))];
}

export function chemistryQuestionRegions(region: ChemistryQuestionRegion): ChemistryBox[] {
  return region.source_regions.length > 0 ? region.source_regions : [region.bbox];
}

export function chemistryStemRegions(region: ChemistryQuestionRegion): ChemistryBox[] {
  return region.stem_regions.length > 0 ? region.stem_regions : region.stem_bbox ? [region.stem_bbox] : [];
}

function contains(outer: ChemistryBox, inner: ChemistryBox): boolean {
  // Localization is approximate; two normalized units allow a border to touch its question box.
  return inner[0] >= outer[0] - 2 && inner[1] >= outer[1] - 2 && inner[2] <= outer[2] + 2 && inner[3] <= outer[3] + 2;
}

function overlappingQuestionOwnership(first: ChemistryBox, second: ChemistryBox): boolean {
  const width = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
  const height = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
  // Tiny edge padding and narrow slivers do not indicate copied question content. A substantial
  // intersection, including one region contained in another, cannot belong to two questions.
  if (width <= 2 || height <= 2) return false;
  const firstArea = (first[2] - first[0]) * (first[3] - first[1]);
  const secondArea = (second[2] - second[0]) * (second[3] - second[1]);
  return width * height >= Math.min(firstArea, secondArea) * 0.05;
}

function printedSectionKey(section: string | null): string {
  return section?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? '';
}

function validatePhysicalRegions(boxes: ChemistryBox[], field: string): void {
  for (const [index, box] of boxes.entries()) {
    if (boxes.slice(0, index).some((earlier) => overlappingQuestionOwnership(earlier, box))) {
      throw errors.extractionFailed(`Chemistry ${field} repeats or significantly overlaps its own physical source regions.`);
    }
  }
}

function validateStemReadingOrder(sourceRegions: ChemistryBox[], stemRegions: ChemistryBox[]): void {
  let previousOwner = -1;
  for (const box of stemRegions) {
    const owner = sourceRegions.findIndex((source) => contains(source, box));
    if (owner < previousOwner) throw errors.extractionFailed('Chemistry stem regions changed the reading order of their source question parts.');
    previousOwner = owner;
  }
}

function validateQuestionOwnership(regions: ChemistryQuestionRegion[]): void {
  const labelScopes = new Map<string, Set<string>>();
  for (const [index, region] of regions.entries()) {
    const label = normalizePrintedQuestionLabel(region.printed_label);
    const scope = printedSectionKey(region.source_section);
    if (label !== null) {
      const scopes = labelScopes.get(label) ?? new Set<string>();
      if (scopes.has(scope) || (scopes.size > 0 && (!scope || scopes.has('')))) {
        throw errors.extractionFailed(`Chemistry source inventory repeated question label ${label} without a distinct printed section.`);
      }
      scopes.add(scope);
      labelScopes.set(label, scopes);
    }
    for (const earlier of regions.slice(0, index)) {
      if (chemistryQuestionRegions(earlier).some((first) => chemistryQuestionRegions(region).some((second) => overlappingQuestionOwnership(first, second)))) {
        throw errors.extractionFailed(`Chemistry question regions ${earlier.printed_label ?? '(unlabelled)'} and ${region.printed_label ?? '(unlabelled)'} overlap significantly; source ownership is ambiguous.`);
      }
    }
  }
}

export function parseChemistryInventory(content: string, layout?: SourcePageLayout | null): ChemistryPageInventory {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw errors.extractionFailed('Chemistry source inventory was not valid JSON.'); }
  const parsed = InventorySchema.safeParse(value);
  if (!parsed.success) throw errors.extractionFailed('Chemistry source inventory had an invalid shape.');
  const inventory = parsed.data;
  if (layout && ['questions', 'mixed'].includes(inventory.page_role)) {
    const nativeBox = (box: SourceBox): ChemistryBox => [Math.floor(box[0] * 1000), Math.floor(box[1] * 1000), Math.ceil(box[2] * 1000), Math.ceil(box[3] * 1000)];
    const matchedAnchors = new Set<SourcePageLayout['questions'][number]>();
    for (const region of inventory.question_regions) {
      const labelMatches = layout.questions.filter((question) => normalizePrintedQuestionLabel(question.printedLabel) === normalizePrintedQuestionLabel(region.printed_label));
      const matches = labelMatches.length > 1
        ? labelMatches.filter((question) => printedSectionKey(region.source_section) !== '' && printedSectionKey(question.sourceSection) === printedSectionKey(region.source_section))
        : labelMatches;
      const anchor = matches[0];
      if (matches.length !== 1 || !anchor || matchedAnchors.has(anchor)) throw errors.extractionFailed('The chemistry inventory does not match a unique visible source question anchor.');
      matchedAnchors.add(anchor);
      if (layout.limitations.includes('column_continuations_require_multi_region_review') && region.source_regions.length > 1) {
        const firstRegion = region.source_regions[0];
        if (!firstRegion || !contains(firstRegion, nativeBox(anchor.anchorBox))) throw errors.extractionFailed('The first part of a multi-region question does not contain its visible native label.');
        if (layout.questions.some((other) => other !== anchor && region.source_regions.some((box) => contains(box, nativeBox(other.anchorBox))))) {
          throw errors.extractionFailed('A multi-region question contains another visible source question label.');
        }
        continue;
      }
      region.bbox = nativeBox(anchor.bbox);
      region.source_regions = [];
      const sourceLabels = anchor.options.map((option) => option.label.toUpperCase());
      const modelLabels = region.options.map((option) => option.label.trim().replace(/^[([{\s]+|[)\]}.:\s]+$/g, '').toUpperCase());
      if (JSON.stringify(sourceLabels) === JSON.stringify(modelLabels)) {
        region.stem_bbox = nativeBox(anchor.stemBbox ?? anchor.bbox);
        region.stem_regions = [];
        region.options = region.options.map((option, index) => ({ ...option, bbox: nativeBox(anchor.options[index]?.bbox ?? anchor.bbox) }));
      } else if (region.options.length === 0) {
        region.stem_bbox = nativeBox(anchor.bbox);
        region.stem_regions = [];
      } else {
        throw errors.extractionFailed('Native source choices and the chemistry inventory disagree; option ownership requires review.');
      }
    }
    if (matchedAnchors.size !== layout.questions.length) throw errors.extractionFailed('The chemistry inventory omitted a visible native question anchor.');
  }
  if (!['questions', 'mixed'].includes(inventory.page_role) && inventory.question_regions.length !== 0) {
    throw errors.extractionFailed('An answer/solution page was incorrectly inventoried as new questions.');
  }
  if (['questions', 'mixed'].includes(inventory.page_role) && inventory.question_regions.length === 0) {
    throw errors.extractionFailed('The chemistry inventory identified a question page but omitted its question regions.');
  }
  for (const region of inventory.question_regions) {
    region.options = region.options.map((option) => ({ ...option, label: option.label.trim().replace(/^[([{\s]+|[)\]}.:\s]+$/g, '') }));
    if (region.source_regions.length) region.bbox = enclosingBox(region.source_regions);
    if (region.stem_regions.length) region.stem_bbox = enclosingBox(region.stem_regions);
    const sourceRegions = chemistryQuestionRegions(region);
    const stemRegions = chemistryStemRegions(region);
    const boxes = [region.bbox, ...sourceRegions, ...stemRegions, ...region.options.map((option) => option.bbox)];
    if (boxes.some((box) => !validBox(box))) throw errors.extractionFailed('Chemistry source inventory returned an empty or inverted crop.');
    if (stemRegions.some((box) => !sourceRegions.some((source) => contains(source, box))) || region.options.some((option) => !sourceRegions.some((source) => contains(source, option.bbox)))) {
      throw errors.extractionFailed('A chemistry stem or option crop belongs outside its question region.');
    }
    validatePhysicalRegions(sourceRegions, 'question');
    validatePhysicalRegions(stemRegions, 'stem');
    validateStemReadingOrder(sourceRegions, stemRegions);
    const labels = region.options.map((option) => option.label.trim().toUpperCase());
    if (labels.some((label) => !label) || new Set(labels).size !== labels.length) throw errors.extractionFailed('Chemistry option ownership is missing or duplicated.');
    if (region.visual_kind !== 'none' && !region.stem_bbox) throw errors.extractionFailed('A chemistry drawing was detected without a complete stem crop.');
  }
  validateQuestionOwnership(inventory.question_regions);
  return inventory;
}

/** Convert model xyxy coordinates to the normalized xywh crop contract. */
export function chemistryCropBox(box: ChemistryBox): [number, number, number, number] {
  return [box[0] / 1000, box[1] / 1000, (box[2] - box[0]) / 1000, (box[3] - box[1]) / 1000];
}

export function chemistrySourceBox(box: ChemistryBox): [number, number, number, number] {
  return [box[0] / 1000, box[1] / 1000, box[2] / 1000, box[3] / 1000];
}

export async function cropChemistryImage(png: Buffer, box: ChemistryBox): Promise<Buffer> {
  const metadata = await sharp(png).metadata();
  if (!metadata.width || !metadata.height) throw errors.extractionFailed('The chemistry source image has no dimensions.');
  const left = Math.max(0, Math.floor(box[0] * metadata.width / 1000));
  const top = Math.max(0, Math.floor(box[1] * metadata.height / 1000));
  const right = Math.min(metadata.width, Math.ceil(box[2] * metadata.width / 1000));
  const bottom = Math.min(metadata.height, Math.ceil(box[3] * metadata.height / 1000));
  return sharp(png).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

export async function cropChemistryRegions(png: Buffer, regions: ChemistryBox[]): Promise<Buffer> {
  return composeNativeSourceCrops(await Promise.all(regions.map((box) => cropChemistryImage(png, box))));
}
