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
type RawDetection = {
  q_no?: unknown;
  has_image?: unknown;
  bbox?: unknown;
  question_text?: unknown;
};

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

/**
 * Parse the model's reply into a `detections` array, tolerating the ways a vision model wraps JSON:
 * a bare object, a ```json fence, or an object with prose around it. Newer detection models don't
 * accept `response_format: json_object`, so we can't rely on the reply being clean JSON.
 */
function parseDetections(content: string, width: number, height: number): DiagramDetection[] {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidate =
    fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
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
    if (bbox) {
      const questionText = typeof item.question_text === 'string' ? item.question_text : '';
      out.push({ qNo, questionText, bbox });
    }
  }
  return out;
}

/**
 * {@link DiagramDetector} backed by an OpenAI vision model — the TypeScript port of the Python
 * image-auto-cropper's OpenAI detector. One call per page. Uses `max_completion_tokens` and leaves
 * `temperature`/`response_format` at their defaults so the same code works on the older gpt-4o and on
 * the newer spatial models (e.g. gpt-5.4, which rejects `max_tokens` and custom temperature) — the
 * upstream cropper runs on gpt-5.4 for tight boxes. Runs on the API request path (interactive).
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
      max_completion_tokens: 4096,
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
