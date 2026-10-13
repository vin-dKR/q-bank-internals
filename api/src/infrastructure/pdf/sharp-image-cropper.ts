import sharp from 'sharp';
import type { ImageCropper } from '../../modules/extraction/index.js';
import { errors } from '../../shared/errors/error-catalog.js';

const SOURCE_REGION_GAP = 12;

/** Join already-cropped native images without resizing or blending their source pixels. */
export async function composeNativeSourceCrops(croppedBuffers: Buffer[]): Promise<Buffer> {
  const first = croppedBuffers[0];
  if (!first) throw errors.extractionFailed('A composite chemistry source crop requires at least one source region.');
  if (croppedBuffers.length === 1) return first;
  const parts = await Promise.all(croppedBuffers.map(async (bytes) => {
    const pixels = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { pixels: pixels.data, width: pixels.info.width, height: pixels.info.height };
  }));
  const width = Math.max(...parts.map((part) => part.width));
  const height = parts.reduce((sum, part) => sum + part.height, 0) + SOURCE_REGION_GAP * (parts.length - 1);
  const channels = 4;
  const canvas = Buffer.alloc(width * height * channels, 255);
  let top = 0;
  for (const part of parts) {
    // Copy complete RGBA rows rather than blending: even transparent source pixels keep their
    // original channels, while the gap and unused right-hand space stay opaque white.
    for (let row = 0; row < part.height; row += 1) {
      const start = row * part.width * channels;
      part.pixels.copy(canvas, (top + row) * width * channels, start, start + part.width * channels);
    }
    top += part.height + SOURCE_REGION_GAP;
  }
  return sharp(canvas, { raw: { width, height, channels } }).png().toBuffer();
}

export class SharpImageCropper implements ImageCropper {
  async dimensions(png: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(png).metadata();
    if (!metadata.width || !metadata.height) throw errors.extractionFailed('A chemistry source image has no readable dimensions.');
    return { width: metadata.width, height: metadata.height };
  }

  async crop(png: Buffer, bbox: [number, number, number, number]): Promise<Buffer> {
    const [x, y, width, height] = bbox;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.00001 || y + height > 1.00001) {
      throw errors.extractionFailed('A chemistry source crop has invalid page coordinates.');
    }
    const metadata = await this.dimensions(png);
    const left = Math.floor(x * metadata.width);
    const top = Math.floor(y * metadata.height);
    const right = Math.min(metadata.width, Math.ceil((x + width) * metadata.width));
    const bottom = Math.min(metadata.height, Math.ceil((y + height) * metadata.height));
    return sharp(png).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
  }

  async compose(png: Buffer, boxes: Array<[number, number, number, number]>): Promise<Buffer> {
    const croppedBuffers = await Promise.all(boxes.map((box) => this.crop(png, box)));
    return composeNativeSourceCrops(croppedBuffers);
  }
}
