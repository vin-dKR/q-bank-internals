/**
 * Read a PNG's pixel dimensions straight from its header — no image library needed. A PNG starts
 * with an 8-byte signature followed immediately by the IHDR chunk, whose width and height are two
 * big-endian uint32s at byte offsets 16 and 20. Used to size the figure-detection call and to tell
 * the client how to scale detected bounding boxes onto the displayed page.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

export type ImageSize = { width: number; height: number };

export function readPngSize(bytes: Buffer): ImageSize {
  if (bytes.length < IHDR_HEIGHT_OFFSET + 4 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG image: missing signature or IHDR header.');
  }
  const width = bytes.readUInt32BE(IHDR_WIDTH_OFFSET);
  const height = bytes.readUInt32BE(IHDR_HEIGHT_OFFSET);
  if (width === 0 || height === 0) {
    throw new Error('PNG reports a zero dimension.');
  }
  return { width, height };
}
