import OpenAI from 'openai';
import sharp from 'sharp';
import type {
  DetectorPage,
  DiagramDetection,
  DiagramDetectionResult,
  DiagramDetector,
  QuestionTop,
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
  target?: unknown;
  option_label?: unknown;
};

/** One entry of the prompt's `questions` array: a numbered question and where its first line starts. */
type RawQuestionTop = {
  q_no?: unknown;
  x_left?: unknown;
  y_top?: unknown;
};

/** Minimum box side (px). Matches the Python cropper — degenerate slivers are almost always noise. */
const MIN_SIDE = 10;

/**
 * Longest side (px) the page is downscaled to before detection. OpenAI's `detail: 'high'` tiles an
 * image into 512px squares; a full-resolution page (~1800×2500) spans dozens of tiles and the model
 * loses the global spatial context, returning loose boxes that swallow question text. A ≤1600px
 * preview fits near a single high-detail pass and yields tight boxes — the school-test cropper's trick.
 */
const PREVIEW_MAX_DIM = 1600;
/** Breathing room added around each upscaled box: 1% of the image dimension, capped at 10px. */
const PAD_FRACTION = 0.01;
const PAD_MAX = 10;

/** Downscale a page PNG so its longest side is ≤ {@link PREVIEW_MAX_DIM}; smaller pages pass through. */
async function toPreview(
  png: Buffer,
  width: number,
  height: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const longest = Math.max(width, height);
  if (longest <= PREVIEW_MAX_DIM) return { png, width, height };
  const scale = PREVIEW_MAX_DIM / longest;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = await sharp(png).resize(w, h, { fit: 'fill' }).png().toBuffer();
  return { png: resized, width: w, height: h };
}

/** Scale a preview-space box up to full-page pixels, add padding, and clamp to the page bounds. */
function upscaleBox(
  bbox: [number, number, number, number],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number,
): [number, number, number, number] {
  const sx = toW / fromW;
  const sy = toH / fromH;
  const padX = Math.min(Math.floor(toW * PAD_FRACTION), PAD_MAX);
  const padY = Math.min(Math.floor(toH * PAD_FRACTION), PAD_MAX);
  const x1 = Math.max(0, Math.round(bbox[0] * sx) - padX);
  const y1 = Math.max(0, Math.round(bbox[1] * sy) - padY);
  const x2 = Math.min(toW, Math.round((bbox[0] + bbox[2]) * sx) + padX);
  const y2 = Math.min(toH, Math.round((bbox[1] + bbox[3]) * sy) + padY);
  return [x1, y1, Math.max(MIN_SIDE, x2 - x1), Math.max(MIN_SIDE, y2 - y1)];
}

/** Scale a preview-space question anchor up to full-page pixels, clamped to the page bounds. */
function upscaleTop(top: QuestionTop, fromW: number, fromH: number, toW: number, toH: number): QuestionTop {
  return {
    qNo: top.qNo,
    xLeft: Math.max(0, Math.min(toW - 1, Math.round(top.xLeft * (toW / fromW)))),
    yTop: Math.max(0, Math.min(toH - 1, Math.round(top.yTop * (toH / fromH)))),
  };
}

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
  const x = Math.max(0, Math.min(width - MIN_SIDE, rx));
  const y = Math.max(0, Math.min(height - MIN_SIDE, ry));
  const w = Math.min(width - x, Math.max(MIN_SIDE, rw));
  const h = Math.min(height - y, Math.max(MIN_SIDE, rh));
  return [x, y, w, h];
}

/**
 * Parse the model's reply into `detections` (figures) and `questionTops` (every numbered question's
 * vertical position), tolerating the ways a vision model wraps JSON: a bare object, a ```json fence,
 * or an object with prose around it. Newer detection models don't accept `response_format:
 * json_object`, so we can't rely on the reply being clean JSON. A reply that omits either array (an
 * older model, or one that ignored the `questions` request) yields an empty array for that half, and
 * the matcher falls back to its number/text strategies.
 */
function parseReply(
  content: string,
  width: number,
  height: number,
): { detections: DiagramDetection[]; questionTops: QuestionTop[] } {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  const candidate =
    fenced ?? (start !== -1 && end > start ? content.slice(start, end + 1) : content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { detections: [], questionTops: [] };
  }

  return {
    detections: parseDetections((parsed as { detections?: unknown }).detections, width, height),
    questionTops: parseQuestionTops((parsed as { questions?: unknown }).questions, width, height),
  };
}

function parseDetections(raw: unknown, width: number, height: number): DiagramDetection[] {
  if (!Array.isArray(raw)) return [];
  const out: DiagramDetection[] = [];
  for (const item of raw as RawDetection[]) {
    const qNo = toFiniteInt(item.q_no);
    if (qNo === null || item.has_image !== true) continue;
    const bbox = clampBox(item.bbox, width, height);
    if (bbox) {
      const questionText = typeof item.question_text === 'string' ? item.question_text : '';
      const target = item.target === 'option' ? 'option' : 'question';
      const optionLabel = typeof item.option_label === 'string' && item.option_label.trim()
        ? item.option_label.trim().replace(/^[\s[(]+/, '').replace(/[\s)\].]+$/, '').toUpperCase()
        : null;
      out.push({ qNo, questionText, target, optionLabel, bbox });
    }
  }
  return out;
}

/** Parse `questions` into clamped `{ qNo, xLeft, yTop }` layout anchors, dropping malformed rows. */
function parseQuestionTops(raw: unknown, width: number, height: number): QuestionTop[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionTop[] = [];
  for (const item of raw as RawQuestionTop[]) {
    const qNo = toFiniteInt(item.q_no);
    const yTop = toFiniteInt(item.y_top);
    const xLeft = toFiniteInt(item.x_left);
    if (qNo === null || yTop === null || xLeft === null) continue;
    out.push({
      qNo,
      xLeft: Math.max(0, Math.min(width - 1, xLeft)),
      yTop: Math.max(0, Math.min(height - 1, yTop)),
    });
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
    // Detect on a downscaled preview, then scale the boxes back up to full-page pixels (see
    // {@link PREVIEW_MAX_DIM}). The returned coordinates are in the full page's pixels, so the
    // service, matcher, and browser crop are all unaffected by this being an internal optimisation.
    const preview = await toPreview(page.png, page.width, page.height);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: detectorPrompt(preview.width, preview.height) },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${preview.png.toString('base64')}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message.content ?? '{}';
    const parsed = parseReply(content, preview.width, preview.height);
    const detections = parsed.detections.map((detection) => ({
      ...detection,
      bbox: upscaleBox(detection.bbox, preview.width, preview.height, page.width, page.height),
    }));
    const questionTops = parsed.questionTops.map((top) =>
      upscaleTop(top, preview.width, preview.height, page.width, page.height),
    );
    const usage: AiTokenUsage = {
      model: this.model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      callCount: 1,
    };
    // No layout anchors means the matcher loses its strongest (geometric) signal and falls back to the
    // model's per-figure question number — the exact case that mis-maps figures on two-column pages.
    // Surface it loudly with a snippet of the reply so the cause (model ignored `questions`) is visible.
    if (detections.length > 0 && questionTops.length === 0) {
      logger.warn(
        { replyPreview: content.slice(0, 400) },
        'diagram detection returned figures but no question anchors — figure→question mapping degraded',
      );
    }
    logger.info(
      { figures: detections.length, questions: questionTops.length },
      'diagram detection done',
    );
    return { detections, questionTops, usage };
  }
}
