import type { AiTokenUsage } from '../usage/index.js';

/** One rendered page handed to the detector, with the pixel dimensions the model reasons about. */
export type DetectorPage = { png: Buffer; width: number; height: number };

/**
 * One diagram the model located on the page: the printed question number it belongs to and a tight
 * bounding box `[x, y, width, height]` in the page's natural pixels. The service maps `qNo` back to
 * the extracted question so the crop attaches to the right card.
 */
export type DiagramDetection = { qNo: number; bbox: [number, number, number, number] };

/** Detection results paired with the token spend the model reported producing them. */
export type DiagramDetectionResult = { detections: DiagramDetection[]; usage: AiTokenUsage };

/**
 * Diagram-detection PORT (§3), owned by the questions module. Implemented in `infrastructure/ai`
 * with an OpenAI vision model (ported from the Python image-auto-cropper), plus a null-object
 * adapter used when no API key is configured. Powers the Verify screen's "auto-detect figures".
 */
export interface DiagramDetector {
  /** Locate the diagrams on one rendered page. Returns one detection per figure found. */
  detect(page: DetectorPage): Promise<DiagramDetectionResult>;
}
