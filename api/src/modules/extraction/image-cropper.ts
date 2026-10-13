/** Crop a normalized xywh source region without changing the original PDF or diagram. */
export interface ImageCropper {
  dimensions(png: Buffer): Promise<{ width: number; height: number }>;
  crop(png: Buffer, bbox: [number, number, number, number]): Promise<Buffer>;
  /** Stack native source crops in reading order, preserving every source pixel without resizing. */
  compose(png: Buffer, boxes: Array<[number, number, number, number]>): Promise<Buffer>;
}
