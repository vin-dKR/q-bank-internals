import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import sharp from 'sharp';
import { z } from 'zod';
import type { OcrLine } from '../../modules/ingestion/index.js';
import { normalizePrintedQuestionLabel, type SourceBox, type SourceOptionAnchor, type SourceQuestionAnchor, type SourcePageLayout } from '../../modules/extraction/index.js';

type TextBox = { text: string; box: SourceBox; baseline: number };
type Raster = { data: Buffer; width: number; height: number };
type NativePageEvidence = { image: Raster; items: TextBox[]; contentBox: SourceBox; width: number; height: number };
type Matrix = [number, number, number, number, number, number];
const MatrixSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const NativeTextItemSchema = z.object({ str: z.string(), transform: MatrixSchema, width: z.number(), height: z.number() });
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const QUESTION_LABEL = /^((?:[A-Z]{1,4}[-.]\d{1,4}|\d{1,3})[.)])(?=\s|$)/u;
const OPTION_LABEL = /^\(([A-Z]|[IVX]+|\d{1,2})\)(?=\s|$)/u;
const SOURCE_HEADING = /^(?:Section\s*\(|Exercise\s*[-\d]|PART\s*[-–])/iu;
const FOOTER_TEXT = /^(?:Reg\.\s*Corp|Website\s*:|Toll\s*Free|Corporate\s*Office)/iu;

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function transformedBox(box: SourceBox, matrix: Matrix): SourceBox {
  const points = [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map(([x = 0, y = 0]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
  return [Math.min(...points.map((point) => point[0] ?? 0)), Math.min(...points.map((point) => point[1] ?? 0)), Math.max(...points.map((point) => point[0] ?? 0)), Math.max(...points.map((point) => point[1] ?? 0))];
}

function normalized(box: SourceBox, width: number, height: number): SourceBox {
  return [Math.max(0, box[0] / width), Math.max(0, box[1] / height), Math.min(1, box[2] / width), Math.min(1, box[3] / height)];
}

function contains(outer: SourceBox, inner: SourceBox): boolean {
  return inner[0] >= outer[0] - 0.001 && inner[1] >= outer[1] - 0.001 && inner[2] <= outer[2] + 0.001 && inner[3] <= outer[3] + 0.001;
}

/** Imported split-page Forms retain invisible text outside their BBox; PDF text alone ignores it. */
function formContentBox(functions: number[], argumentsList: unknown[], viewport: Matrix, width: number, height: number): SourceBox {
  let matrix: Matrix = IDENTITY;
  const states: Matrix[] = [];
  let formDepth = 0;
  const outerForms: SourceBox[] = [];
  for (const [index, op] of functions.entries()) {
    const args = argumentsList[index];
    if (op === OPS.save) states.push(matrix);
    else if (op === OPS.restore) matrix = states.pop() ?? IDENTITY;
    else if (op === OPS.transform) {
      const parsed = MatrixSchema.safeParse(args);
      if (parsed.success) matrix = multiply(matrix, parsed.data);
    } else if (op === OPS.paintFormXObjectBegin) {
      states.push(matrix);
      const entries = Array.isArray(args) ? args : [];
      const transform = MatrixSchema.safeParse(entries[0]);
      const box = BoxSchema.safeParse(entries[1]);
      if (transform.success) matrix = multiply(matrix, transform.data);
      if (formDepth === 0 && box.success) {
        const visible = normalized(transformedBox(box.data, multiply(viewport, matrix)), width, height);
        if ((visible[2] - visible[0]) * (visible[3] - visible[1]) > 0.2) outerForms.push(visible);
      }
      formDepth += 1;
    } else if (op === OPS.paintFormXObjectEnd) {
      matrix = states.pop() ?? IDENTITY;
      formDepth = Math.max(0, formDepth - 1);
    }
  }
  if (outerForms.length === 0) return [0, 0, 1, 1];
  return [Math.min(...outerForms.map((box) => box[0])), Math.min(...outerForms.map((box) => box[1])), Math.max(...outerForms.map((box) => box[2])), Math.max(...outerForms.map((box) => box[3]))];
}

async function raster(png: Buffer): Promise<Raster> {
  const { data, info } = await sharp(png).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function visibleInk(image: Raster, box: SourceBox): boolean {
  const left = Math.max(0, Math.floor(box[0] * image.width));
  const right = Math.min(image.width, Math.ceil(box[2] * image.width));
  const top = Math.max(0, Math.floor(box[1] * image.height));
  const bottom = Math.min(image.height, Math.ceil(box[3] * image.height));
  let ink = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) if ((image.data[y * image.width + x] ?? 255) < 150) ink += 1;
  }
  return ink >= Math.max(3, (right - left) * (bottom - top) * 0.008);
}

/** The final white gutter before an anchor is a boundary; label baselines can sit inside a tall ring. */
function rowGutter(image: Raster, left: number, right: number, from: number, to: number, minimum: number): number | null {
  const x0 = Math.max(0, Math.floor(left * image.width));
  const x1 = Math.min(image.width, Math.ceil(right * image.width));
  const y0 = Math.max(0, Math.ceil(from * image.height));
  const y1 = Math.min(image.height, Math.floor(to * image.height));
  let start: number | null = null;
  let result: number | null = null;
  for (let y = y0; y <= y1; y += 1) {
    let ink = 0;
    for (let x = x0; x < x1; x += 1) if ((image.data[y * image.width + x] ?? 255) < 150) ink += 1;
    if (ink <= 1) { start ??= y; continue; }
    if (start !== null && y - start >= minimum * image.height) result = (start + y) / 2 / image.height;
    start = null;
  }
  if (start !== null && y1 + 1 - start >= minimum * image.height) result = (start + y1 + 1) / 2 / image.height;
  return result;
}

function markerBox(item: TextBox, marker: string): SourceBox {
  // PDFjs sometimes merges label and prose into one item; estimate only the short label's width.
  const fraction = marker.length / Math.max(marker.length, item.text.length);
  return [item.box[0], item.box[1], item.box[0] + (item.box[2] - item.box[0]) * fraction, item.box[3]];
}

function optionPanel(image: Raster, items: TextBox[], question: SourceQuestionAnchor, pageHeight: number): { stemBbox: SourceBox; options: SourceOptionAnchor[] } | null {
  const markers = items.flatMap((item) => {
    const match = OPTION_LABEL.exec(item.text.trim());
    const label = match?.[1];
    if (!match || !label || !contains(question.bbox, item.box)) return [];
    return [{ label, anchorBox: markerBox(item, match[0]), baseline: item.baseline }];
  }).sort((a, b) => a.baseline - b.baseline || a.anchorBox[0] - b.anchorBox[0]);
  const starts = markers.flatMap((marker, index) => marker.label === 'A' || marker.label === '1' ? [index] : []);
  const start = starts.at(-1);
  if (start === undefined) return null;
  const panel = markers.slice(start);
  if (panel.length < 2 || new Set(panel.map((marker) => marker.label)).size !== panel.length) return null;
  const first = panel[0];
  if (!first) return null;
  const padding = 2 / pageHeight;
  const panelTop = rowGutter(image, question.bbox[0], question.bbox[2], question.anchorBox[3], first.anchorBox[1], 1.5 / pageHeight) ?? Math.max(question.anchorBox[3], first.anchorBox[1] - padding);
  const rows: Array<typeof panel> = [];
  for (const marker of panel) {
    const row = rows.at(-1);
    if (row?.[0] && Math.abs(row[0].baseline - marker.baseline) <= 5 / pageHeight) row.push(marker);
    else rows.push([marker]);
  }
  const rowStarts = rows.map((row, index) => {
    if (index === 0) return panelTop;
    const current = row[0];
    const prior = rows[index - 1]?.[0];
    if (!current || !prior) return panelTop;
    return rowGutter(image, question.bbox[0], question.bbox[2], prior.baseline, current.anchorBox[1], 0.8 / pageHeight) ?? (prior.baseline + current.anchorBox[1]) / 2;
  });
  const options = rows.flatMap((row, index) => row.map((marker, position): SourceOptionAnchor => ({
    label: marker.label,
    anchorBox: marker.anchorBox,
    bbox: [position === 0 ? question.bbox[0] : Math.max(question.bbox[0], marker.anchorBox[0] - padding), rowStarts[index] ?? panelTop, row[position + 1] ? Math.max(question.bbox[0], (row[position + 1]?.anchorBox[0] ?? question.bbox[2]) - padding) : question.bbox[2], rowStarts[index + 1] ?? question.bbox[3]],
  })));
  return { stemBbox: [question.bbox[0], question.bbox[1], question.bbox[2], panelTop], options };
}

function buildLayout(source: SourcePageLayout['source'], image: Raster, items: TextBox[], contentBox: SourceBox, width: number, height: number): SourcePageLayout | null {
  const candidates = items.flatMap((item) => {
    const match = QUESTION_LABEL.exec(item.text.trim());
    const printedLabel = normalizePrintedQuestionLabel(match?.[1]);
    if (!match || !printedLabel || !contains(contentBox, item.box)) return [];
    const anchorBox = markerBox(item, match[0]);
    return visibleInk(image, anchorBox) ? [{ printedLabel, anchorBox, baseline: item.baseline }] : [];
  }).sort((a, b) => a.anchorBox[0] - b.anchorBox[0] || a.baseline - b.baseline);
  if (candidates.length === 0) return null;
  const columns: Array<typeof candidates> = [];
  for (const anchor of candidates) {
    const column = columns.find((existing) => existing[0] && Math.abs(existing[0].anchorBox[0] - anchor.anchorBox[0]) < 0.12);
    if (column) column.push(anchor); else columns.push([anchor]);
  }
  const questions: SourceQuestionAnchor[] = [];
  for (const [columnIndex, column] of columns.entries()) {
    column.sort((a, b) => a.baseline - b.baseline);
    const first = column[0];
    if (!first) continue;
    const left = Math.max(contentBox[0], first.anchorBox[0] - 3 / width);
    const nextColumn = columns[columnIndex + 1]?.[0];
    const right = nextColumn ? nextColumn.anchorBox[0] - 8 / width : contentBox[2];
    const columnItems = items.filter((item) => item.box[0] >= left && item.box[0] < right && contains(contentBox, item.box));
    const footerItems = columnItems.filter((item) => item.box[1] > 0.5 && FOOTER_TEXT.test(item.text.trim()));
    let footerTop = Math.min(contentBox[3], ...footerItems.map((item) => item.box[1] - 2 / height));
    const last = column.at(-1);
    if (footerItems.length > 0 && last) footerTop = rowGutter(image, left, right, last.baseline, footerTop, 4 / height) ?? footerTop;
    const starts = column.map((anchor, index) => {
      if (index === 0) {
        const heading = columnItems.filter((item) => SOURCE_HEADING.test(item.text.trim()) && item.box[3] <= anchor.anchorBox[1]).sort((a, b) => b.box[3] - a.box[3])[0];
        return rowGutter(image, left, right, heading?.box[3] ?? contentBox[1], anchor.anchorBox[1], 4 / height) ?? Math.max(contentBox[1], anchor.anchorBox[1] - 1 / height);
      }
      const previous = column[index - 1];
      return previous ? rowGutter(image, left, right, previous.baseline, anchor.anchorBox[1], 4 / height) ?? Math.max(previous.baseline, anchor.anchorBox[1] - 2 / height) : anchor.anchorBox[1];
    });
    for (const [index, anchor] of column.entries()) {
      const top = starts[index] ?? anchor.anchorBox[1];
      let bottom = starts[index + 1] ?? footerTop;
      const interveningHeading = columnItems.find((item) => SOURCE_HEADING.test(item.text.trim()) && item.box[1] > anchor.baseline && item.box[1] < bottom);
      if (interveningHeading) bottom = interveningHeading.box[1] - 1 / height;
      const precedingHeading = [...columnItems].filter((item) => SOURCE_HEADING.test(item.text.trim()) && item.box[3] <= anchor.anchorBox[1]).sort((a, b) => b.box[3] - a.box[3])[0];
      const question: SourceQuestionAnchor = { printedLabel: anchor.printedLabel, sourceSection: precedingHeading?.text ?? null, anchorBox: anchor.anchorBox, bbox: [left, top, right, bottom], stemBbox: null, options: [] };
      const panel = optionPanel(image, columnItems, question, height);
      if (panel) { question.stemBbox = panel.stemBbox; question.options = panel.options; }
      else question.stemBbox = question.bbox;
      questions.push(question);
    }
  }
  return {
    source, width, height, contentBox, questions,
    limitations: [
      ...(source === 'ocr' ? ['ocr_anchors_require_inventory_agreement'] : []),
      ...(columns.length > 1 ? ['column_continuations_require_multi_region_review'] : []),
    ],
  };
}

/** Shared native evidence retains the same source geometry for layout and compact printed keys. */
async function readNativePageEvidence(bytes: Buffer, pageNumber: number, png: Buffer): Promise<NativePageEvidence> {
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const viewportMatrix = MatrixSchema.parse(viewport.transform);
    const [text, operators, image] = await Promise.all([page.getTextContent(), page.getOperatorList(), raster(png)]);
    const contentBox = formContentBox(operators.fnArray, operators.argsArray, viewportMatrix, viewport.width, viewport.height);
    const items: TextBox[] = text.items.flatMap((item) => {
      const parsed = NativeTextItemSchema.safeParse(item);
      if (!parsed.success) return [];
      const value = parsed.data;
      if (!value.str.trim() || Math.abs(value.transform[1]) > 0.01 || Math.abs(value.transform[2]) > 0.01) return [];
      const matrix = multiply(viewportMatrix, value.transform);
      const box = normalized([matrix[4], matrix[5] - value.height, matrix[4] + value.width, matrix[5]], viewport.width, viewport.height);
      return [{ text: value.str, box, baseline: matrix[5] / viewport.height }];
    });
    return { image, items, contentBox, width: viewport.width, height: viewport.height };
  } finally {
    await document.destroy();
  }
}

/** Read only anchors backed by both PDF coordinates and pixels visible after imported-Form clipping. */
export async function readNativePageLayout(bytes: Buffer, pageNumber: number, png: Buffer): Promise<SourcePageLayout | null> {
  const evidence = await readNativePageEvidence(bytes, pageNumber, png);
  return buildLayout('native_pdf', evidence.image, evidence.items, evidence.contentBox, evidence.width, evidence.height);
}

const COMPACT_KEY_LABEL = /^[A-Z]{1,4}[-.]\d{1,4}[.)]$/u;
const COMPACT_KEY_PAIR = /^([A-Z]{1,4}[-.]\d{1,4}[.)])\s+\(([A-L])\)$/u;
const COMPACT_KEY_ANSWER = /^\(([A-L])\)$/u;

/**
 * Read literal compact choice keys locally, never question prose or worked formulas. Only full
 * printed prefixes are accepted; bare numbers require external section context and are left out.
 * At least one physical row must contain two complete pairs to establish a compact key table.
 */
export async function readNativeChoiceKeys(bytes: Buffer, pageNumber: number, png: Buffer): Promise<Record<string, string> | null> {
  const evidence = await readNativePageEvidence(bytes, pageNumber, png);
  return nativeChoiceKeysFromEvidence(evidence);
}

function nativeChoiceKeysFromEvidence(evidence: NativePageEvidence): Record<string, string> | null {
  const visible = evidence.items.filter((item) => contains(evidence.contentBox, item.box) && visibleInk(evidence.image, item.box));
  const rows: TextBox[][] = [];
  for (const item of visible.sort((a, b) => a.baseline - b.baseline || a.box[0] - b.box[0])) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (first && Math.abs(first.baseline - item.baseline) <= 2 / evidence.height) row.push(item);
    else rows.push([item]);
  }
  const keys = new Map<string, string>();
  let hasCompactRow = false;
  for (const row of rows) {
    row.sort((a, b) => a.box[0] - b.box[0]);
    // Rejecting the entire prefixed row prevents accepting just its first token from a solution.
    if (!row.some((item) => /^[A-Z]{1,4}[-.]\d{1,4}[.)](?:\s|$)/u.test(item.text.trim()))) continue;
    let pairs = 0;
    for (let index = 0; index < row.length; index += 1) {
      const labelItem = row[index];
      if (!labelItem) return null;
      const combined = COMPACT_KEY_PAIR.exec(labelItem.text.trim());
      let label = combined?.[1];
      let answer = combined?.[2];
      if (!combined) {
        if (!COMPACT_KEY_LABEL.test(labelItem.text.trim())) return null;
        const answerItem = row[index + 1];
        const choice = answerItem ? COMPACT_KEY_ANSWER.exec(answerItem.text.trim()) : null;
        if (!answerItem || !choice?.[1]) return null;
        const fontHeight = Math.min(labelItem.box[3] - labelItem.box[1], answerItem.box[3] - answerItem.box[1]);
        const gap = answerItem.box[0] - labelItem.box[2];
        if (fontHeight <= 0 || gap < -0.001 || gap > fontHeight * evidence.height / evidence.width * 2.5) return null;
        label = labelItem.text.trim();
        answer = choice[1];
        index += 1;
      }
      const fullLabel = normalizePrintedQuestionLabel(label);
      if (!fullLabel || !answer || keys.has(fullLabel)) return null;
      keys.set(fullLabel, answer);
      pairs += 1;
    }
    if (pairs >= 2) hasCompactRow = true;
  }
  return hasCompactRow && keys.size > 0 ? Object.fromEntries(keys) : null;
}

/** Rasterization consumers need only one native-PDF parse and one pixel buffer for both products. */
export async function readNativePageSources(bytes: Buffer, pageNumber: number, png: Buffer): Promise<{
  layout: SourcePageLayout | null;
  choiceKeys: Record<string, string> | null;
}> {
  const evidence = await readNativePageEvidence(bytes, pageNumber, png);
  return {
    layout: buildLayout('native_pdf', evidence.image, evidence.items, evidence.contentBox, evidence.width, evidence.height),
    choiceKeys: nativeChoiceKeysFromEvidence(evidence),
  };
}

/** Local OCR locates labels only; it is never used to recognize molecular bonds or infer chemistry. */
export async function pageLayoutFromOcr(png: Buffer, lines: OcrLine[]): Promise<SourcePageLayout | null> {
  const image = await raster(png);
  const items: TextBox[] = lines.filter((line) => line.confidence >= 60).map((line) => ({ text: line.text, box: normalized([line.box.left, line.box.top, line.box.right, line.box.bottom], image.width, image.height), baseline: line.box.bottom / image.height }));
  return buildLayout('ocr', image, items, [0, 0, 1, 1], image.width, image.height);
}
