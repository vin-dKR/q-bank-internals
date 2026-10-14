import sharp from 'sharp';
import { errors } from '../../shared/errors/error-catalog.js';

const MAX_PREVIEW_SIDE = 1400;
const FRAME_MARGIN = 56;
const MAX_SOURCE_SIDE = MAX_PREVIEW_SIDE - 2 * FRAME_MARGIN;
const NORMALIZED_BOUND = 1000;
const GRID_INTERVAL = 100;

export type ChemistryInventoryPreview = {
  png: Buffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Pixel rectangle occupied by the source inside the scaffolded preview, excluding axis margins. */
  sourceFrame: { left: number; top: number; width: number; height: number };
  coordinateInstructions: string;
};

function coordinateScaffold(width: number, height: number): Buffer {
  const outerWidth = width + 2 * FRAME_MARGIN;
  const outerHeight = height + 2 * FRAME_MARGIN;
  const lines: string[] = [];
  const labels: string[] = [];
  for (let coordinate = 0; coordinate <= NORMALIZED_BOUND; coordinate += GRID_INTERVAL) {
    const x = FRAME_MARGIN + width * coordinate / NORMALIZED_BOUND;
    const y = FRAME_MARGIN + height * coordinate / NORMALIZED_BOUND;
    if (coordinate > 0 && coordinate < NORMALIZED_BOUND) {
      lines.push(`<path d="M${String(x)} ${String(FRAME_MARGIN)}V${String(FRAME_MARGIN + height)} M${String(FRAME_MARGIN)} ${String(y)}H${String(FRAME_MARGIN + width)}"/>`);
    }
    labels.push(`<text x="${String(x)}" y="${String(FRAME_MARGIN - 12)}" text-anchor="middle">${String(coordinate)}</text>`);
    labels.push(`<text x="${String(FRAME_MARGIN - 10)}" y="${String(y + 4)}" text-anchor="end">${String(coordinate)}</text>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${String(outerWidth)}" height="${String(outerHeight)}">
    <g fill="none" stroke="#d7e8f0" stroke-width="0.7" stroke-opacity="0.75">${lines.join('')}</g>
    <rect x="${String(FRAME_MARGIN - 1)}" y="${String(FRAME_MARGIN - 1)}" width="${String(width + 2)}" height="${String(height + 2)}" fill="none" stroke="#326884" stroke-width="1.5"/>
    <g font-family="sans-serif" font-size="12" font-weight="600" fill="#24576f">${labels.join('')}</g>
    <text x="${String(FRAME_MARGIN)}" y="18" font-family="sans-serif" font-size="12" font-weight="600" fill="#24576f">SOURCE FRAME: x increases right; y increases down</text>
    <text x="${String(FRAME_MARGIN)}" y="${String(FRAME_MARGIN + height + 28)}" font-family="sans-serif" font-size="11" fill="#24576f">0..1000 coordinates refer only to SOURCE inside the frame</text>
  </svg>`);
}

/**
 * Give localization a global page view with an explicit coordinate system. This is a separate
 * preview; chemical recognition and source crops must continue to use the original page PNG.
 */
export async function createChemistryInventoryPreview(sourcePng: Buffer): Promise<ChemistryInventoryPreview> {
  const metadata = await sharp(sourcePng).metadata();
  if (!metadata.width || !metadata.height) throw errors.extractionFailed('The chemistry inventory source image has no dimensions.');
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const resizedSource = await sharp(sourcePng)
    .resize(width, height, { fit: 'fill', withoutEnlargement: true })
    .png().toBuffer();
  const previewWidth = width + 2 * FRAME_MARGIN;
  const previewHeight = height + 2 * FRAME_MARGIN;
  const canvas = await sharp({
    create: { width: previewWidth, height: previewHeight, channels: 4, background: '#ffffff' },
  }).composite([{ input: resizedSource, left: FRAME_MARGIN, top: FRAME_MARGIN }]).png().toBuffer();
  // Multiply puts a faint grid on white paper while keeping black source ink black. The source
  // bytes are never mutated, and the grid is never present in any recognition or persisted crop.
  const png = await sharp(canvas).composite([{ input: coordinateScaffold(width, height), blend: 'multiply' }]).png().toBuffer();
  return {
    png,
    width: previewWidth,
    height: previewHeight,
    sourceWidth,
    sourceHeight,
    sourceFrame: { left: FRAME_MARGIN, top: FRAME_MARGIN, width, height },
    coordinateInstructions: [
      `LOCALIZATION PREVIEW ONLY: the original source is ${String(sourceWidth)} by ${String(sourceHeight)} pixels.`,
      `The supplied preview is ${String(previewWidth)} by ${String(previewHeight)} pixels, with SOURCE inside the blue frame at preview pixel rectangle [${String(FRAME_MARGIN)}, ${String(FRAME_MARGIN)}, ${String(FRAME_MARGIN + width)}, ${String(FRAME_MARGIN + height)}].`,
      'All returned [LEFT, TOP, RIGHT, BOTTOM] boxes must use normalized SOURCE coordinates 0..1000, measured from the inner framed source; exclude every outer axis margin.',
      'The inner frame top-left is [0,0]; bottom-right is [1000,1000]. The top/left labels and thin grid mark each 100 SOURCE units; x increases right and y increases down.',
      'Axis labels, the grid, and SOURCE FRAME captions are localization scaffolding, not printed question content. Do not include them in a source box or transcribe them.',
      'Use the scaffold to count question boundaries and locate labels. Chemical recognition and the actual crops use the unmodified original source image.',
    ].join('\n'),
  };
}
