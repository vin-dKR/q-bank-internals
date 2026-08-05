import OpenAI from 'openai';
import type {
  DetectorPage,
  DiagramDetection,
  DiagramDetectionResult,
  DiagramDetector,
} from '../../modules/questions/index.js';
import type { AiTokenUsage } from '../../modules/usage/index.js';
import { logger } from '../../shared/logger/logger.js';
import { detectorPrompt } from './prompts/detection-prompts.js';

/** Shape the detector prompt asks the model to return, before we validate + clamp each box. */
type RawDetection = { q_no?: unknown; has_image?: unknown; bbox?: unknown };

/** Minimum box side (px). Matches the Python cropper — degenerate slivers are almost always noise. */
const MIN_SIDE = 10;

function toFiniteInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Clamp a raw `[x, y, w, h]` to the image bounds, dropping boxes that can't be made valid. */
function clampBox(
  raw: unknown,
  width: number,
  height: number,
): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [rx, ry, rw, rh] = raw.map(toFiniteInt);
  if (rx === null || ry === null || rw === null || rh === null) return null;
  if (rx === undefined || ry === undefined || rw === undefined || rh === undefined) return null;
  const x = Math.max(0, Math.min(width - 1, rx));
  const y = Math.max(0, Math.min(height - 1, ry));
  const w = Math.max(MIN_SIDE, Math.min(width - x, rw));
  const h = Math.max(MIN_SIDE, Math.min(height - y, rh));
  return [x, y, w, h];
}

function parseDetections(content: string, width: number, height: number): DiagramDetection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const raw = (parsed as { detections?: unknown }).detections;
  if (!Array.isArray(raw)) return [];

  const out: DiagramDetection[] = [];
  for (const item of raw as RawDetection[]) {
    const qNo = toFiniteInt(item.q_no);
    if (qNo === null || item.has_image !== true) continue;
    const bbox = clampBox(item.bbox, width, height);
    if (bbox) out.push({ qNo, bbox });
  }
  return out;
}

/**
 * {@link DiagramDetector} backed by an OpenAI vision model — the TypeScript port of the Python
 * image-auto-cropper's OpenAI detector. One call per page, `response_format: json_object`, low
 * temperature for stable boxes. Runs on the API request path (the Verify auto-crop is interactive).
 */
export class OpenAiDiagramDetector implements DiagramDetector {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async detect(page: DetectorPage): Promise<DiagramDetectionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: detectorPrompt(page.width, page.height) },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${page.png.toString('base64')}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message.content ?? '{}';
    const detections = parseDetections(content, page.width, page.height);
    const usage: AiTokenUsage = {
      model: this.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      callCount: 1,
    };
    logger.info({ figures: detections.length }, 'diagram detection done');
    return { detections, usage };
  }
}
