export type OcrLine = {
  text: string;
  confidence: number;
  box: { left: number; top: number; right: number; bottom: number };
  warnings?: string[];
};

/** One sequential OCR worker owned by a single detection run. */
export interface PageOcrSession {
  recognize(png: Buffer): Promise<OcrLine[]>;
  close(): Promise<void>;
}

export interface PageOcr {
  open(): Promise<PageOcrSession>;
}
